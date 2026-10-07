# dyn.py: bake follow-through for hair and skirt from the body's real motion (sampled in the runtime at 60 fps).
# Each hanging chain (hair middle -> hair ends, skirt) is a damped angular spring around the pose read from the keyframes:
# when the head/hip accelerates the chain lags the other way, when it stops the chain overshoots and settles. Loops are
# simulated for two cycles and the second one is kept, so they join seamlessly. Result: rotation keys every 1/30 s.
#   python dyn.py <skeleton json> <samples json from tools/sample.mjs (bones head,hip)>
import sys, json, math, numpy as np
SK, SAMP = sys.argv[1], sys.argv[2]
sk = json.load(open(SK)); S = json.load(open(SAMP, encoding="utf-8"))
FPS = 60.0
CHAINS = {  # bone: (driver [0 = head, 1 = hip], natural freq Hz, damping ratio, deg per unit/s^2 of anchor push, deg per deg/s^2 of anchor turn, clamp deg, parent)
    "hair_a2": (0, 2.4, 0.36, 0.0030, 0.0024, 9, None), "hair_a3": (0, 1.9, 0.32, 0.0036, 0.0030, 14, "hair_a2"),
    "hair_b2": (0, 2.8, 0.40, 0.0018, 0.0015, 6, None), "hair_b3": (0, 2.2, 0.36, 0.0024, 0.0018, 9, "hair_b2"),
    "skirt": (1, 3.2, 0.45, 0.0020, 0.0, 5, None)}

def keyed(tl, t):
    """Linear read of an existing rotate timeline (the pose read from the keyframes is the spring's rest)."""
    if not tl: return 0.0
    ks = tl
    if t <= ks[0]["time"]: return ks[0].get("angle", 0)
    for a, b in zip(ks, ks[1:]):
        if a["time"] <= t <= b["time"]:
            f = (t - a["time"]) / max(b["time"] - a["time"], 1e-6); return a.get("angle", 0) + (b.get("angle", 0) - a.get("angle", 0)) * f
    return ks[-1].get("angle", 0)

for name, clip in S.items():
    a = sk["animations"].get(name)
    if a is None: continue
    fr = np.array(clip["frames"], float)           # [frame, bone, (x, y, rot)]
    n = len(fr); dur = clip["duration"]; loop = clip["loop"]
    if n < 4: continue
    res = {}
    for bone, (di, hz, zeta, g_lin, g_ang, cl, par) in CHAINS.items():
        if not any(b["name"] == bone for b in sk["bones"]): continue
        x, y, r = fr[:, di, 0], fr[:, di, 1], np.unwrap(np.radians(fr[:, di, 2]))
        ax = np.gradient(np.gradient(x, 1 / FPS), 1 / FPS); ay = np.gradient(np.gradient(y, 1 / FPS), 1 / FPS)
        aa = np.degrees(np.gradient(np.gradient(r, 1 / FPS), 1 / FPS))
        if par and par in res: aa = aa + np.gradient(np.gradient(res[par], 1 / FPS), 1 / FPS) * 0.6   # the end also feels the middle swinging
        k = (2 * math.pi * hz) ** 2; c = 2 * zeta * math.sqrt(k)
        tl = (a.get("bones", {}).get(bone) or {}).get("rotate", [])
        th = np.zeros(n); v = 0.0; cur = keyed(tl, 0.0)
        for i in range(n):
            t = (i / FPS) % dur if loop else min(i / FPS, dur)
            rest = keyed(tl, t)
            # hanging chain: a sideways push of the anchor (ax > 0) swings the free end back (clockwise = negative)
            drive = -(g_lin * ax[i] + g_ang * aa[i]) * k
            acc = -k * (cur - rest) - c * v + drive
            v += acc / FPS; cur += v / FPS
            cur = rest + max(-cl, min(cl, cur - rest)); th[i] = cur
        res[bone] = th
        per = int(round(dur * FPS))
        seg = th[n - per - 1:] if loop and n > per + 1 else th[: per + 1]
        keys = [{"time": round(j / FPS, 4), "angle": round(float(seg[j]), 2)} for j in range(0, len(seg), 2)]
        if keys[-1]["time"] < dur - 1e-3: keys.append({"time": round(dur, 4), "angle": round(float(seg[-1] if not loop else seg[0]), 2)})
        if loop: keys[-1]["angle"] = keys[0]["angle"]
        a.setdefault("bones", {}).setdefault(bone, {})["rotate"] = keys
    print(f"{name}: baked {', '.join(f'{b} ±{np.ptp(v):.0f}°' for b, v in res.items())}")
json.dump(sk, open(SK, "w"), separators=(",", ":"))
