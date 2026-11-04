"""Bake continuous depth turns of the blade, keeping its rigid local geometry.

The blade's local x axis is aligned to its length before applying yaw projection.
This avoids the old step-rotation and arbitrary twelve-percent length substitute.
Run after retarget, once, on its newly generated model.
"""
import sys, json, math

filename = sys.argv[1]
sk = json.load(open(filename, encoding='utf-8'))
if sk.get('diyBladeProjection'): raise SystemExit('Model already projected; rebuild from its baseline before projecting again')
bone = {b['name']: b for b in sk['bones']}
tip = bone['sword_tip']
beta = math.atan2(tip['y'], tip['x'])
length = math.hypot(tip['x'], tip['y'])
deg = lambda r: math.degrees(r)
wrap = lambda d: (d + 180) % 360 - 180
anim = sk['animations']['Skill_1']['bones']

def value(keys, t, name, default=0):
    if not keys: return default
    if t <= keys[0].get('time', 0): return keys[0].get(name, default)
    for a, b in zip(keys, keys[1:]):
        if a.get('time', 0) <= t < b['time']:
            f = (t - a.get('time', 0)) / (b['time'] - a.get('time', 0))
            return a.get(name, default) + (b.get(name, default) - a.get(name, default)) * f
    return keys[-1].get(name, default)

def world(name, t):
    b = bone[name]; p = b.get('parent'); x, y, angle = world(p, t) if p else (0., 0., 0.)
    track = anim.get(name, {})
    dx = b.get('x', 0) + value(track.get('translate'), t, 'x')
    dy = b.get('y', 0) + value(track.get('translate'), t, 'y')
    r = math.radians(angle)
    return x + dx * math.cos(r) - dy * math.sin(r), y + dx * math.sin(r) + dy * math.cos(r), angle + b.get('rotation', 0) + value(track.get('rotate'), t, 'angle')

original = lambda t: world('sword', t)[2] + deg(beta)
phases = [(0., .16, 0., math.pi, original(0), wrap(original(.16) + 180)),
          (.16, .28, math.pi, 0., wrap(original(.16) + 180), original(.28)),
          (.52, .70, 0., math.pi, original(.52), wrap(original(.70) + 180)),
          (.70, .84, math.pi, 0., wrap(original(.70) + 180), original(.84))]
rotate, scale = [], []
duration = 1.32
times = sorted(set([round(i / 120, 6) for i in range(math.ceil(duration * 120) + 1)] + [0, .16, .28, .70, .84, duration]))
previous = None
for t in times:
    if t > duration: continue
    angle, sx = original(t), 1.
    for start, stop, yaw0, yaw1, angle0, angle1 in phases:
        if start <= t <= stop:
            f = (t - start) / (stop - start)
            sx = math.cos(yaw0 + (yaw1 - yaw0) * f)
            angle = angle0 + wrap(angle1 - angle0) * f
            break
    _, hilt_y, _ = world('sword', t)
    if hilt_y + length * sx * math.sin(math.radians(angle)) < 2 and abs(sx) > .01:
        bound = max(-1., min(1., (2 - hilt_y) / (length * sx)))
        root = deg(math.asin(bound))
        angle += min((wrap(root - angle), wrap(180 - root - angle)), key=abs)
    local = angle - world('hand_r', t)[2] - deg(beta)
    if previous is not None: local = previous + wrap(local - previous)
    previous = local
    rotate.append({'time': t, 'angle': round(local, 4)})
    scale.append({'time': t, 'x': round(sx, 6), 'y': 1})

def reorient(item):
    x, y = item.get('x', 0), item.get('y', 0)
    item['x'] = x * math.cos(beta) + y * math.sin(beta)
    item['y'] = -x * math.sin(beta) + y * math.cos(beta)
    item['rotation'] = item.get('rotation', 0) - deg(beta)

bone['sword']['rotation'] = bone['sword'].get('rotation', 0) + deg(beta)
for b in sk['bones']:
    if b.get('parent') == 'sword': reorient(b)
for skin in sk['skins']:
    for attachment in skin['attachments'].get('sword', {}).values(): reorient(attachment)
anim['sword']['rotate'] = rotate
anim['sword']['scale'] = scale
sk['diyBladeProjection'] = True
json.dump(sk, open(filename, 'w', encoding='utf-8'), separators=(',', ':'))
print('Continuous blade projection baked:', filename)
