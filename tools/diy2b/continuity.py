"""Contact-preserving temporal fitting for the existing 2B rig.

The input sheets remain read-only. Frame ids identify samples, not adjacency;
contacts and hip directions follow the chronological samples retained by an action.
"""
import copy
import math
import numpy as np


def stabilize(seq, keys, ids, times, end, action, legs, solve, fk, semantics, rotations):
    out = copy.deepcopy(seq)
    span = min(l['l1'] + l['l2'] for l in legs.values())
    origin = seq[-1 if action.get('rootRef') == 'last' else 0]['hip_t'][0]
    refs = {s: legs[s]['ankle'].copy() for s in 'rl'}
    last_x = 0.0
    for i, (p, key_id) in enumerate(zip(out, ids)):
        sem = semantics.get(key_id, {})
        previous = semantics.get(ids[i - 1], {}) if i else sem
        raw = np.array(seq[i]['hip_t'], float)
        raw_x = raw[0] - origin
        direction = sem.get('moves_from_prev', {}).get('hips', '')
        if i:
            delta = raw[0] - seq[i - 1]['hip_t'][0]
            if 'forward' in direction: delta = max(0.0, delta)
            elif 'back' in direction: delta = min(0.0, delta)
            elif direction: delta = 0.0
            else: delta = raw_x - last_x
            last_x += float(np.clip(delta, -span * .12, span * .12))
        elif action.get('rootRef') == 'last': last_x = float(np.clip(raw_x, -span * .2, span * .2))
        x = float(np.clip(last_x, -span * .18, span * .18))
        y = float(raw[1])
        lying = bool(sem.get('lying'))
        kneel = [s for s in 'rl' if sem.get('knee_on_ground', {}).get('leg_' + s) and not lying]
        planted = [s for s in 'rl' if sem.get('planted', {}).get('leg_' + s) and s not in kneel and not sem.get('airborne')]
        if not sem: planted = list(p['planted'])
        targets = {}
        for s in 'rl':
            if s not in seq[i]['ankle_w']: continue
            relative = seq[i]['ankle_w'][s] - legs[s]['hip'] - raw
            if s not in planted and not kneel and not lying and 0 < i < len(seq) - 1:
                # Hidden ankles produce single-sample spikes. Fit the free
                # foot against its temporal neighbours, never a support foot.
                if s in seq[i-1]['ankle_w'] and s in seq[i+1]['ankle_w']:
                    left = seq[i-1]['ankle_w'][s] - legs[s]['hip'] - np.array(seq[i-1]['hip_t'])
                    right = seq[i+1]['ankle_w'][s] - legs[s]['hip'] - np.array(seq[i+1]['hip_t'])
                    f = (times[i] - times[i-1]) / (times[i+1] - times[i-1])
                    relative = .3 * relative + .7 * (left + (right - left) * f)
            target = legs[s]['hip'] + np.array([x, y]) + relative
            movement = sem.get('moves_from_prev', {}).get('leg_' + s + '_foot', '')
            if s in planted:
                # Never re-anchor a stationary support foot to a noisy pixel.
                was_planted = previous.get('planted', {}).get('leg_' + s, True)
                if i and not was_planted and movement != 'stays':
                    refs[s][0] = float(np.clip(target[0], legs[s]['ankle'][0] - span * .3, legs[s]['ankle'][0] + span * .3))
                target = refs[s].copy()
            target[1] = max(float(target[1]), 4.0)
            targets[s] = target
        if kneel:
            p['torso'] = float(np.clip(p['torso'], -30, 25))
            # A knee contact fixes the pelvis BEFORE the other leg is solved.
            s = kneel[0]; l = legs[s]
            x = 0.0
            dx = l['l1'] * .22
            knee = np.array([l['hip'][0] + dx, 8.0])
            y = knee[1] + math.sqrt(l['l1'] ** 2 - dx ** 2) - l['hip'][1]
            for s in kneel:
                l = legs[s]; knee = np.array([l['hip'][0] + l['l1'] * .22, 8.0])
                targets[s] = knee + np.array([-l['l2'], 0.0])
            for s in planted:
                targets[s] = np.array([legs[s]['hip'][0] + span * .70, legs[s]['ankle'][1]])
                # Fit the forward support foot to this view's limb proportions.
                # Use the most slumped torso angle so it remains one stable
                # support position throughout the kneeling loop.
                for attempt in range(10):
                    trial = dict(p, hip_t=(x, y), torso=-30.)
                    th, sh, ft = solve(s, legs[s]['hip'] + np.array([x, y]), targets[s])
                    trial['thigh_' + s], trial['shin_' + s], trial['foot_' + s] = th, sh, ft
                    w = fk(trial)
                    center = (w['thigh_r'] + w['thigh_l']) / 2
                    down = math.atan2(*(center - w['head'])[::-1])
                    thigh = math.atan2(*(w['shin_' + s] - w['thigh_' + s])[::-1])
                    flex = (math.degrees(thigh - down) + 180) % 360 - 180
                    if -45 <= flex <= 150: break
                    targets[s][0] += span * .025
        elif planted and not lying:
            # The pelvis must lie inside every support leg's reachable circle.
            ceiling = min(targets[s][1] + math.sqrt(max((legs[s]['l1'] + legs[s]['l2'] - .1) ** 2 - (targets[s][0] - legs[s]['hip'][0] - x) ** 2, 1.0)) - legs[s]['hip'][1] for s in planted if s in targets)
            y = min(y, ceiling)
        p['hip_t'] = (x, y)
        for s, target in targets.items():
            th, sh, ft = solve(s, legs[s]['hip'] + np.array([x, y]), target)
            p['thigh_' + s], p['shin_' + s], p['foot_' + s] = th, sh, ft
        if planted and not kneel and not lying:
            # A cartoon rig may have a very short thigh. Raising the pelvis
            # within its support circles prevents a crouch from folding the
            # thigh back past the torso while preserving both foot contacts.
            for attempt in range(16):
                w = fk(p); center = (w['thigh_r'] + w['thigh_l']) / 2
                down = math.atan2(*(center - w['head'])[::-1])
                flexes = [(math.degrees(math.atan2(*(w['shin_' + s] - w['thigh_' + s])[::-1]) - down) + 180) % 360 - 180 for s in planted]
                if all(-45 <= f <= 155 for f in flexes): break
                y = min(y + span * .025, ceiling)
                p['hip_t'] = (x, y)
                for s, target in targets.items():
                    th, sh, ft = solve(s, legs[s]['hip'] + np.array([x, y]), target)
                    p['thigh_' + s], p['shin_' + s], p['foot_' + s] = th, sh, ft
        p['ankle_w'] = {s: fk(p)['foot_' + s] for s in 'rl'}
        p['planted'] = planted
        last_x = x
    if action.get('restore', True) and action['name'] != 'Die':
        rest = copy.deepcopy(out[-1])
        for b in rotations + ['hair_a', 'hair_b']: rest[b] = 0.0
        rest['hip_t'] = (0.0, 0.0)
        rest['ankle_w'] = {s: legs[s]['ankle'].copy() for s in 'rl'}
        rest['planted'] = list('rl'); rest['grip_l'] = False; rest['arm_front'] = False
        rest['sword_world'] = out[0]['sword_world']
        if end - times[-1] < .05:
            # The final video samples are the settle phase; don't hide a reset
            # in a one-millisecond tail after the last sample.
            t0 = times[-1] - .18
            for i, t in enumerate(times):
                if t <= t0: continue
                w = min(1., (t - t0) / max(times[-1] - t0, .001))
                w = w * w * (3 - 2 * w)
                for b in rotations + ['hair_a', 'hair_b']:
                    out[i][b] = (1 - w) * out[i][b]
                out[i]['hip_t'] = tuple((1 - w) * np.array(out[i]['hip_t']))
                out[i]['ankle_w'] = {s: fk(out[i])['foot_' + s] for s in 'rl'}
            out[-1] = rest
        elif end > times[-1]: out.append(rest)
    return out


def stitch(animations):
    """Use one pose at a shared clip boundary, including loop wrap-around."""
    links = [('Skill_3_Begin', 'Skill_3_End'), ('Skill_3_End', 'Stun_Skill_3'),
             ('Skill_2_Begin', 'Skill_2_Loop'), ('Skill_2_Loop', 'Skill_2_End')]
    for previous, following in links:
        a, b = animations.get(previous, {}), animations.get(following, {})
        for bone, tracks in a.get('bones', {}).items():
            if bone.startswith('pod'): continue
            destination = b.setdefault('bones', {}).setdefault(bone, {})
            for channel in ('translate', 'rotate', 'scale'):
                if not tracks.get(channel) or not destination.get(channel): continue
                start = dict(tracks[channel][-1]); start['time'] = 0
                # Keep the following clip's interpolation, not the previous
                # clip's final key (which carries no outgoing curve).
                curve = {k: v for k, v in destination[channel][0].items() if k in ('curve', 'c2', 'c3', 'c4')}
                for k in ('curve', 'c2', 'c3', 'c4'): start.pop(k, None)
                start.update(curve); destination[channel][0] = start
                if following == 'Stun_Skill_3':
                    last = dict(start); last['time'] = destination[channel][-1]['time']
                    destination[channel][-1] = last
