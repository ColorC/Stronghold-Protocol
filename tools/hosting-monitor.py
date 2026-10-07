#!/usr/bin/env python3
"""One bounded, anonymous server sample. Invoked by a systemd minute timer."""
import argparse
import datetime
import json
import os
import pathlib
import subprocess
import time
import urllib.request


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json(path, value):
    pending = path.with_name(path.name + '.pending')
    pending.write_text(json.dumps(value, separators=(',', ':')) + '\n')
    pending.replace(path)


def optional_int(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def network(interface):
    for line in pathlib.Path('/proc/net/dev').read_text().splitlines()[2:]:
        name, values = line.split(':')
        if name.strip() == interface:
            fields = list(map(int, values.split()))
            return {'rx': fields[0], 'tx': fields[8]}
    raise ValueError('configured network interface is unavailable')


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    import math
    return round(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)], 3)


def request_metrics(log, now, window=300):
    counts = {'windowSeconds': window, 'total': 0, 'status5xx': 0, 'status4xx': 0,
              'malformedRows': 0}
    timings = {'checkpoint': [], 'admission': []}
    for file in [log.with_name(log.name + '.2'), log.with_name(log.name + '.1'), log]:
        if not file.exists():
            continue
        if file.is_symlink() or not file.is_file():
            raise ValueError('request log must be a plain file')
        with file.open('rb') as stream:
            # Only owned bounded logs are read. Skip an incomplete first line when seeking.
            size = file.stat().st_size
            if size > 2 * 1024 * 1024:
                stream.seek(size - 2 * 1024 * 1024)
                stream.readline()
            for line in stream:
                if not line.endswith(b'\n'):
                    continue  # producer has not finished this record; next sample reads it
                try:
                    row = json.loads(line)
                    at = datetime.datetime.fromisoformat(row['at']).timestamp()
                    status = int(row['status'])
                    duration = float(row['duration']) * 1000
                except (ValueError, KeyError, TypeError):
                    counts['malformedRows'] += 1
                    continue
                if now - window <= at <= now + 5:
                    counts['total'] += 1
                    counts['status5xx'] += 500 <= status < 600
                    counts['status4xx'] += 400 <= status < 500
                    if row.get('class') in timings:
                        timings[row['class']].append(duration)
    for name, values in timings.items():
        counts[name] = {'count': len(values), 'p95Ms': percentile(values, .95),
                        'p50Ms': percentile(values, .5),
                        'maxMs': round(max(values), 3) if values else None}
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--request-log', required=True)
    parser.add_argument('--interface', default='eth0')
    parser.add_argument('--unit', default='stronghold-protocol.service')
    args = parser.parse_args()
    output = pathlib.Path(args.output)
    log = pathlib.Path(args.request_log)
    if not output.is_absolute() or not log.is_absolute():
        raise ValueError('output and log must be absolute paths')
    for parent in [output, *output.parents]:
        if parent.exists() and parent.is_symlink():
            raise ValueError('output ancestors must not be links')
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    now = time.time()
    at = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).isoformat()
    cpu = list(map(int, pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    traffic = network(args.interface)
    service = subprocess.run(['systemctl', 'show', args.unit, '-p', 'MainPID', '-p',
                              'MemoryCurrent', '-p', 'CPUUsageNSec', '-p', 'NRestarts'],
                             check=True, capture_output=True, text=True, timeout=5)
    properties = dict(line.split('=', 1) for line in service.stdout.splitlines() if '=' in line)
    pid = optional_int(properties.get('MainPID')) or 0
    app_ns = optional_int(properties.get('CPUUsageNSec'))
    current = {'atEpoch': now, 'monotonic': started, 'cpu': cpu, 'traffic': traffic,
               'pid': pid, 'appCpuNs': app_ns}
    previous = load_json(output / 'state.json', None)
    elapsed = started - previous['monotonic'] if previous else 0
    comparable = previous and 0 < elapsed < 3600
    host_cpu = app_cpu = rx_bps = tx_bps = None
    if comparable:
        total = sum(cpu) - sum(previous['cpu'])
        idle = sum(cpu[3:5]) - sum(previous['cpu'][3:5])
        if total > 0 and 0 <= idle <= total:
            host_cpu = round(100 * (total - idle) / total, 3)
        if previous['pid'] == pid and app_ns is not None and previous['appCpuNs'] is not None and app_ns >= previous['appCpuNs']:
            app_cpu = round((app_ns - previous['appCpuNs']) / 1e9 / elapsed * 100, 3)
        for direction in ['rx', 'tx']:
            delta = traffic[direction] - previous['traffic'][direction]
            if delta >= 0:
                if direction == 'rx':
                    rx_bps = round(delta * 8 / elapsed)
                else:
                    tx_bps = round(delta * 8 / elapsed)
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024
              for line in pathlib.Path('/proc/meminfo').read_text().splitlines()
              if line.split(':')[0] in ['MemTotal', 'MemAvailable']}
    rss = None
    if pid and pathlib.Path(f'/proc/{pid}/status').exists():
        rss_rows = [line for line in pathlib.Path(f'/proc/{pid}/status').read_text().splitlines()
                    if line.startswith('VmRSS:')]
        rss = int(rss_rows[0].split()[1]) * 1024 if rss_rows else None
    disk = os.statvfs('/')
    game = {'healthy': False, 'cpuPercent': app_cpu,
            'memoryBytes': optional_int(properties.get('MemoryCurrent')), 'rssBytes': rss,
            'active': None, 'waiting': None, 'activeLimit': None, 'waitingLimit': None,
            'restarts': int(properties.get('NRestarts', '0')), 'uptimeSeconds': None}
    try:
        with urllib.request.urlopen('http://127.0.0.1:18010/healthz', timeout=3) as response:
            health = json.load(response)
        game.update(healthy=health['ok'], active=health['admission']['active'],
                    waiting=health['admission']['waiting'],
                    activeLimit=health['admission']['limit'],
                    waitingLimit=health['admission']['maxWaiting'],
                    uptimeSeconds=health['uptimeSec'])
    except Exception as error:
        game['healthError'] = type(error).__name__
    snapshot = {'at': at, 'intervalSeconds': round(elapsed, 3) if comparable else None,
                'host': {'cpuPercent': host_cpu, 'availableMemoryBytes': memory['MemAvailable'],
                         'totalMemoryBytes': memory['MemTotal'], 'txBitsPerSecond': tx_bps,
                         'rxBitsPerSecond': rx_bps,
                         'systemDiskAvailableBytes': disk.f_bavail * disk.f_frsize},
                'game': game, 'requests': request_metrics(log, now)}
    history = load_json(output / 'history.json', [])
    history.append({'at': at, 'hostCpuPercent': host_cpu, 'gameCpuPercent': app_cpu,
                    'txBitsPerSecond': tx_bps, 'active': game['active'], 'waiting': game['waiting']})
    history = history[-360:]  # six hours at the normal minute cadence
    write_json(output / 'history.json', history)
    snapshot['history'] = history[-60:]  # browser gets only the latest hour
    snapshot['samplerDurationMs'] = round((time.monotonic() - started) * 1000, 3)
    write_json(output / 'latest.json', snapshot)
    write_json(output / 'state.json', current)


if __name__ == '__main__':
    main()
