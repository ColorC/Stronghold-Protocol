# retarget.py: drive 2B's ORIGINAL rig (same drawings, same part sizes) with poses read off AI keyframes.
# The keyframes are analysis material only: each key's part-label map gives joints (same definitions measured on the base
# static image), the change of every limb direction from the base becomes that bone's rotation, the waist gives the hip
# translation, the legs are solved with two-bone IK onto the measured ankles (planted ones stay on the floor), the back hair
# and skirt follow the measured hang with a short lag. No drawing is swapped, so the figure cannot flicker or change size.
#   python retarget.py <model dir> <base view dir> <keys dir> <spec.json> [skeleton name] [only=Name,Name]
import os, sys, json, math, numpy as np
from PIL import Image
from scipy import ndimage as ndi
MD, BASE, KD, SPEC = sys.argv[1:5]
NAME = sys.argv[5] if len(sys.argv) > 5 and not sys.argv[5].startswith("only=") else "char_diy_2b"
ONLY = next((a[5:].split(",") for a in sys.argv[5:] if a.startswith("only=")), None)
sk = json.load(open(f"{MD}/{NAME}.json")); spec = json.load(open(SPEC, encoding="utf-8"))
E = {"curve": 0.25, "c2": 0, "c3": 0.75, "c4": 1}; CURVES = {"E": E, "EO": {"curve": 0.1, "c2": 0.6, "c3": 0.3, "c4": 1},
     "EI": {"curve": 0.6, "c2": 0, "c3": 0.9, "c4": 0.4}, "L": {}}
ang = lambda a, b: math.degrees(math.atan2(-(b[1] - a[1]), b[0] - a[0]))      # px coords (y down) -> CCW degrees, y up
norm = lambda a: (a + 180) % 360 - 180

# ---------------- measuring (identical definitions for the base image and every key) ----------------
def contact(M, a, b):
    if not M[a].any() or not M[b].any(): return None
    ys, xs = np.nonzero(M[a] & ndi.binary_dilation(M[b], iterations=2))
    return None if len(xs) < 3 else np.array([xs.mean(), ys.mean()])
def centroid(m, part=None):
    ys, xs = np.nonzero(m)
    if not len(xs): return None
    k = ys <= np.quantile(ys, 0.15) if part == "top" else ys >= np.quantile(ys, 0.85) if part == "bottom" else slice(None)
    return np.array([xs[k].mean(), ys[k].mean()])
first = lambda *v: next((x for x in v if x is not None), None)

def repair_labels(seg, alpha, ground, LEG):
    """Limb labels only count where they connect down their chain (skirt->thigh->shin->foot, torso->upper arm->forearm->hand);
    detached patches take the surrounding label; anything below the floor is dropped (the next sheet row bleeding in)."""
    seg = seg.copy()
    if ground is not None: seg[int(ground) + 10:, :] = 0
    M = lambda n: seg == LEG.index(n) + 1
    reject = np.zeros(seg.shape, bool)
    sk_ = M("skirt"); top = np.quantile(np.nonzero(sk_)[0], 0.1) if sk_.sum() > 50 else None
    for roots, chain in ((("skirt",), ("thigh_r", "shin_r", "foot_r")), (("skirt",), ("thigh_l", "shin_l", "foot_l")),
                         (("torso",), ("upperarm_r", "forearm_r", "hand_r")), (("torso",), ("upperarm_l", "forearm_l", "hand_l"))):
        parent = np.any([M(r) for r in roots], axis=0)
        if not parent.any(): parent = M("torso")
        for part in chain:
            m = M(part)
            if not m.any(): continue
            lab, nl = ndi.label(m); near = ndi.binary_dilation(parent, iterations=4)
            ok = [i for i in range(1, nl + 1) if (near & (lab == i)).any()]
            if part.startswith("thigh") and top is not None: ok = [i for i in ok if ndi.center_of_mass(lab == i)[0] > top]
            if not ok and parent.any():
                dist = ndi.distance_transform_edt(~parent); d = [dist[lab == i].min() for i in range(1, nl + 1)]
                ok = [int(np.argmin(d)) + 1] if min(d) < 40 else []
            keep = np.isin(lab, ok); reject |= m & ~keep
            if keep.any(): parent = keep
    if reject.any():
        good = (seg > 0) & ~reject
        _, (iy, ix) = ndi.distance_transform_edt(~good, return_indices=True)
        seg = np.where(reject, seg[iy, ix], seg)
    return seg

def measure(seg, LEG):
    M = {n: seg == i + 1 for i, n in enumerate(LEG)}
    for n in ("hair_a", "hair_b", "face", "torso", "skirt", "sword"): M.setdefault(n, np.zeros(seg.shape, bool))
    J = {}
    J["waist"] = first(contact(M, "torso", "skirt"), centroid(M["skirt"], "top"), centroid(M["torso"], "bottom"))
    J["neck"] = first(contact(M, "face", "torso"), centroid(M["face"], "bottom"), centroid(M["hair_b"], "bottom"))
    J["crown"] = first(centroid(M["hair_b"], "top"), centroid(M["hair_a"], "top"))
    for s in "rl":
        J[f"shoulder_{s}"] = first(contact(M, f"upperarm_{s}", "torso"), centroid(M[f"upperarm_{s}"], "top"))
        J[f"elbow_{s}"] = first(contact(M, f"upperarm_{s}", f"forearm_{s}"), centroid(M[f"upperarm_{s}"], "bottom"), centroid(M[f"forearm_{s}"], "top"))
        J[f"wrist_{s}"] = first(contact(M, f"forearm_{s}", f"hand_{s}"), centroid(M[f"hand_{s}"]), centroid(M[f"forearm_{s}"], "bottom"))
        J[f"hip_{s}"] = first(contact(M, f"thigh_{s}", "skirt"), centroid(M[f"thigh_{s}"], "top"), centroid(M[f"shin_{s}"], "top"))
        J[f"knee_{s}"] = first(contact(M, f"thigh_{s}", f"shin_{s}"), centroid(M[f"thigh_{s}"], "bottom"), centroid(M[f"shin_{s}"], "top"))
        J[f"ankle_{s}"] = first(contact(M, f"shin_{s}", f"foot_{s}"), centroid(M[f"shin_{s}"], "bottom"), centroid(M[f"foot_{s}"], "top"))
        J[f"sole_{s}"] = first(centroid(M[f"foot_{s}"], "bottom"), centroid(M[f"shin_{s}"], "bottom"))
        legm = M[f"thigh_{s}"] | M[f"shin_{s}"] | M[f"foot_{s}"]                 # lowest point of the whole leg: planted test
        J[f"low_{s}"] = None if not legm.any() else np.array([np.nonzero(legm)[1].mean(), float(np.nonzero(legm.any(1))[0].max())])
    grip = first(contact(M, "sword", "hand_r"), contact(M, "sword", "hand_l"), contact(M, "sword", "forearm_r"))
    if M["sword"].any():
        sy, sx = np.nonzero(M["sword"])
        if grip is None:                               # hand not touching the blade: of the blade's two ends, the grip is the one nearer the body
            body_c = first(J["shoulder_r"], J["neck"], J["waist"])
            pts = np.stack([sx, sy], 1).astype(float); c0 = pts.mean(0); u = np.linalg.svd(pts - c0, full_matrices=False)[2][0]
            pr = (pts - c0) @ u; ends = [pts[np.argmin(pr)], pts[np.argmax(pr)]]
            grip = min(ends, key=lambda e: np.linalg.norm(e - body_c)) if body_c is not None else ends[0]
        if grip is not None: i = np.argmax((sx - grip[0]) ** 2 + (sy - grip[1]) ** 2); J["tip"] = np.array([sx[i], sy[i]], float)
    J["grip"] = grip
    if J["wrist_r"] is None: J["wrist_r"] = grip           # hand label lost (hidden / mislabelled): the hand is where it grips
    body = np.isin(seg, [i + 1 for i, n in enumerate(LEG) if n not in ("sword", "smear")])
    for a_, b_ in (("knee_r", "knee_l"), ("ankle_r", "ankle_l"), ("sole_r", "sole_l"), ("low_r", "low_l")):
        if J.get(a_) is not None and J.get(b_) is not None and J[a_][0] > J[b_][0] + 4: J[a_], J[b_] = J[b_], J[a_]
    J["low_all"] = np.array([0.0, float(np.nonzero(body.any(1))[0].max())]) if body.any() else None
    J["hairA"] = centroid(M["hair_a"]); J["skirtB"] = centroid(M["skirt"], "bottom")
    J["hips"] = (J["hip_r"] + J["hip_l"]) / 2 if J["hip_r"] is not None and J["hip_l"] is not None else J["waist"]
    return J

# ---------------- base ----------------
bleg = [n for n, _ in json.load(open(f"{BASE}/s2-split/legend.json"))["legend"]]
B = measure(np.load(f"{BASE}/s2-split/labels.npy"), bleg)
P = json.load(open(f"{BASE}/s3-parts/parts.json"))["joints"]
balpha = np.asarray(Image.open(f"{BASE}/s1-static/static.png"))[..., 3]
S0 = 0.2; box = (P["ankle_r"][0] + P["ankle_l"][0]) / 2; boy = float(np.nonzero((balpha > 8).any(1))[0].max())
bworld = lambda p: np.array([(p[0] - box) * S0, (boy - p[1]) * S0])
bones = {b["name"]: b for b in sk["bones"]}
def bw(name):                                     # setup world position of a bone (all base bones have zero setup rotation)
    x = y = 0.0; b = bones[name]
    while b: x += b.get("x", 0); y += b.get("y", 0); b = bones.get(b.get("parent"))
    return np.array([x, y])
LEGB = {s: {"hip": bw(f"thigh_{s}"), "knee": bw(f"shin_{s}"), "ankle": bw(f"foot_{s}")} for s in "rl"}
for s, L in LEGB.items():
    L["l1"] = float(np.linalg.norm(L["knee"] - L["hip"])); L["l2"] = float(np.linalg.norm(L["ankle"] - L["knee"]))
    L["r1"] = math.degrees(math.atan2(*(L["knee"] - L["hip"])[::-1])); L["r2"] = math.degrees(math.atan2(*(L["ankle"] - L["knee"])[::-1]))
DIRS = {"torso": ("hips", "neck"), "head": ("neck", "crown"), "upperarm_r": ("shoulder_r", "elbow_r"), "forearm_r": ("elbow_r", "wrist_r"),
        "hand_r": ("wrist_r", "grip"), "sword": ("grip", "tip"), "upperarm_l": ("shoulder_l", "elbow_l"), "forearm_l": ("elbow_l", "wrist_l"),
        "hair_a": ("crown", "hairA"), "skirt": ("waist", "skirtB")}
PARENT = {"torso": None, "head": "torso", "upperarm_r": "torso", "forearm_r": "upperarm_r", "hand_r": "forearm_r", "sword": "hand_r",
          "upperarm_l": "torso", "forearm_l": "upperarm_l", "hair_a": "head", "skirt": None}
base_ang = {b: ang(B[a], B[c]) for b, (a, c) in DIRS.items() if B[a] is not None and B[c] is not None}
print("base measured directions:", {b: round(v) for b, v in base_ang.items()})

# ---------------- keys ----------------
LEG = [n for n, _ in json.load(open(f"{KD}/atk_k1/s2-split/legend.json"))["legend"]]
bseg = np.load(f"{BASE}/s2-split/labels.npy")
st_h = boy - np.nonzero(ndi.binary_opening(np.isin(bseg, [bleg.index(n) + 1 for n in bleg if n not in ("sword", "smear")]), iterations=2).any(1))[0].min()
SEM = {}
for _sh in {a["sheet"] for a in spec["actions"]}:
    _f = os.path.join(KD, f"{_sh}.semantics.json")
    if os.path.exists(_f): SEM[_sh] = {fr["k"]: fr for fr in json.load(open(_f, encoding="utf-8"))["frames"]}
HEAD_SCALE = {sh for a in spec["actions"] if a.get("scaleBy") == "head" for sh in [a["sheet"]]}
bhead = np.isin(bseg, [bleg.index(n) + 1 for n in ("hair_a", "hair_b", "face") if n in bleg])
head_h = float(np.ptp(np.nonzero(ndi.binary_opening(bhead, iterations=2).any(1))[0]))
def load_sheet(sh, ks):
    ground = {int(k): v for k, v in json.load(open(f"{KD}/{sh}.ground.json")).items()}
    a1 = np.asarray(Image.open(f"{KD}/{sh}_k1/s1-static/static.png"))[..., 3]
    seg1 = repair_labels(np.load(f"{KD}/{sh}_k1/s2-split/labels.npy"), a1, ground[1], LEG)
    body1 = ndi.binary_opening(np.isin(seg1, [LEG.index(n) + 1 for n in LEG if n not in ("sword", "smear")]), iterations=2)
    S = S0 * st_h / (ground[1] - np.nonzero(body1.any(1))[0].min())   # one scale per sheet: calm first frame, crown to floor, labelled body only
    if sh in HEAD_SCALE:                               # the sheet has no standing frame: scale by the head, which keeps its size in any pose
        hd1 = np.isin(seg1, [LEG.index(n) + 1 for n in ("hair_a", "hair_b", "face") if n in LEG])
        S = S0 * head_h / np.ptp(np.nonzero(ndi.binary_opening(hd1, iterations=2).any(1))[0])
    J1 = measure(seg1, LEG)
    ox = np.mean([J1["ankle_r"][0], J1["ankle_l"][0]]) if J1["ankle_r"] is not None and J1["ankle_l"] is not None else np.nonzero(a1 > 8)[1].mean()
    out = {}
    for k in ks:
        al = np.asarray(Image.open(f"{KD}/{sh}_k{k}/s1-static/static.png"))[..., 3]
        J = measure(repair_labels(np.load(f"{KD}/{sh}_k{k}/s2-split/labels.npy"), al, ground[k], LEG), LEG)
        W = lambda p, g=ground[k]: None if p is None else np.array([(p[0] - ox) * S, (g - p[1]) * S])
        out[k] = {"px": J, "W": {j: W(p) for j, p in J.items()}, "ground": ground[k], "S": S, "sem": SEM.get(sh, {}).get(k)}
    p1 = pose(out[1])                                  # the calm first frame: how far this sheet's waist reading sits from the legs'
    bias = (p1["_ty_waist"] - p1["_ty_legs"]) if p1.get("_ty_waist") is not None else 0.0
    for k in out: out[k]["bias"] = bias
    return out

def ik(s, hip, ankle, knee_hint):
    L = LEGB[s]; d = float(np.linalg.norm(ankle - hip)); d = min(max(d, 1e-3), L["l1"] + L["l2"] - 1e-3)
    a = math.atan2(ankle[1] - hip[1], ankle[0] - hip[0]); c = max(-1, min(1, (L["l1"] ** 2 + d * d - L["l2"] ** 2) / (2 * L["l1"] * d)))
    best = None
    for bend in (1, -1):
        t = a + bend * math.acos(c); K = hip + L["l1"] * np.array([math.cos(t), math.sin(t)])
        err = 0 if knee_hint is None else float(np.linalg.norm(K - knee_hint))
        if best is None or err < best[0]: best = (err, math.degrees(t), K)
    _, t_dir, K = best
    end = hip + (ankle - hip) * (d / max(float(np.linalg.norm(ankle - hip)), 1e-3))
    s_dir = math.degrees(math.atan2(end[1] - K[1], end[0] - K[0]))
    th = norm(t_dir - L["r1"]); sh = norm(s_dir - L["r2"] - th)
    return th, sh

ARM = {s: (bones[f"upperarm_{s}"]["length"], bones[f"forearm_{s}"]["length"]) for s in "rl"}
def arm_ik(J, s):
    """World directions (upper, fore) of one arm: shoulder->wrist direction and reach fraction from the key, base bone lengths."""
    sh, el, wr = J[f"shoulder_{s}"], J[f"elbow_{s}"], J[f"wrist_{s}"]
    if sh is None or wr is None: return None
    l1, l2 = ARM[s]; d_key = float(np.linalg.norm(wr - sh))
    full = (float(np.linalg.norm(el - sh)) + float(np.linalg.norm(wr - el))) if el is not None else None
    frac = min(0.999, d_key / full) if full and full > 1 else 0.9
    d = max(abs(l1 - l2) + 1e-3, frac * (l1 + l2)); a = math.atan2(-(wr[1] - sh[1]), wr[0] - sh[0])
    c = max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
    side = 1
    if el is not None:
        cross = (wr[0] - sh[0]) * (-(el[1] - sh[1])) - (-(wr[1] - sh[1])) * (el[0] - sh[0]); side = 1 if cross > 0 else -1
    u = a + side * math.acos(c); E_ = np.array([l1 * math.cos(u), l1 * math.sin(u)]); W_ = np.array([d * math.cos(a), d * math.sin(a)])
    f = math.atan2(W_[1] - E_[1], W_[0] - E_[0])
    return math.degrees(u), math.degrees(f)
def knee_min_d(L, max_fold=150):
    """Shortest hip-ankle distance the leg may reach: the knee folds at most max_fold degrees (a person cannot fold flat)."""
    inner = math.radians(180 - max_fold); return math.sqrt(L["l1"] ** 2 + L["l2"] ** 2 - 2 * L["l1"] * L["l2"] * math.cos(inner))
def knee_fold(K, A_):
    """Seen from the side with the figure facing right, a knee only ever folds one way: the shin turns clockwise from the
    thigh. Score an IK branch by how much it folds that way (works standing, kneeling with the ankle behind, or lying)."""
    th = math.atan2(K[1], K[0]); sh = math.atan2(A_[1] - K[1], A_[0] - K[0])
    return -norm(math.degrees(sh - th))
def leg_solve(s, hp, foot):
    L = LEGB[s]; tgt = np.asarray(foot, float) - hp
    d = min(max(float(np.linalg.norm(tgt)), knee_min_d(L)), L["l1"] + L["l2"] - 1e-3)
    a_ = math.atan2(tgt[1], tgt[0]); c = max(-1, min(1, (L["l1"] ** 2 + d * d - L["l2"] ** 2) / (2 * L["l1"] * d)))
    A_ = d * np.array([math.cos(a_), math.sin(a_)]); best = None
    for side in (1, -1):
        t = a_ + side * math.acos(c); K = L["l1"] * np.array([math.cos(t), math.sin(t)]); score = knee_fold(K, A_)
        if best is None or score > best[0]: best = (score, t, K)
    _, t, K = best
    th = norm(math.degrees(t) - L["r1"]); sh = norm(math.degrees(math.atan2(A_[1] - K[1], A_[0] - K[0])) - L["r2"] - th)
    return th, sh, norm(-th - sh)
def pose(key, foot_lock=None, hip=None):
    """Bone values for one key: local rotations relative to setup, hip translation."""
    J, Wd = key["px"], key["W"]; D = {}
    for b, (a, c) in DIRS.items():
        if b in base_ang and J[a] is not None and J[c] is not None: D[b] = norm(ang(J[a], J[c]) - base_ang[b])
    for s in "rl":
        r = arm_ik(J, s)
        if r: D[f"upperarm_{s}"] = norm(r[0] - base_ang[f"upperarm_{s}"]); D[f"forearm_{s}"] = norm(r[1] - base_ang[f"forearm_{s}"])
    sem = key.get("sem")
    if sem and sem.get("sword_clock") is not None:
        want = (3 - float(sem["sword_clock"])) * 30.0
        if "sword" not in D or abs(norm(base_ang["sword"] + D["sword"] - want)) > 60: D["sword"] = norm(want - base_ang["sword"])
    D.setdefault("torso", 0.0); D.setdefault("head", D["torso"])
    out = {}
    world = {}
    for b in ("torso", "head", "upperarm_r", "forearm_r", "hand_r", "sword", "upperarm_l", "forearm_l", "hair_a", "skirt"):
        p = PARENT[b]; pw = world.get(p, 0.0) if p else 0.0
        w = D.get(b, pw)                               # unmeasured bone: keep its parent's direction (no local bend)
        world[b] = w; out[b] = norm(w - pw)
    out["head"] = max(-18, min(18, out["head"]))
    out["hair_a"] = max(-12, min(12, out["hair_a"] * 0.6)); out["hair_b"] = out["hair_a"] * 0.5   # bends in the hair mesh (hair_mesh.py)
    out["skirt"] = max(-14, min(14, out["skirt"])) * 0.7
    # legs: each leg's hip->ankle direction and how far it is stretched (a fraction of its own measured length, so the key's
    # drawing scale does not matter) give the leg pose with the base bone lengths; the hip height then follows from the planted
    # foot (ankle at its standing height), and its x keeps that foot where the key put it. Airborne: the waist gives the hip.
    hip0 = bw("hip"); waist = Wd["waist"] if Wd["waist"] is not None else hip0
    tx, ty = (waist - bworld(B["waist"])) if Wd["waist"] is not None else (0.0, 0.0)
    vec, planted, lost = {}, [], []
    touching = J["low_all"] is not None and (key["ground"] - J["low_all"][1]) * key["S"] < 12
    tw = math.radians(world.get("torso", 0.0)); fwd = np.array([math.cos(tw), math.sin(tw)])   # where she faces (right at rest)
    for s in "rl":                                     # an ankle read above the hip on a body that touches the floor is a mislabel
        if touching and Wd[f"ankle_{s}"] is not None and Wd[f"hip_{s}"] is not None and Wd[f"ankle_{s}"][1] > Wd[f"hip_{s}"][1] - 10:
            J[f"ankle_{s}"] = None; Wd[f"ankle_{s}"] = None
    for s in "rl":
        L = LEGB[s]; h, k_, an = J[f"hip_{s}"], J[f"knee_{s}"], J[f"ankle_{s}"]
        if an is None and k_ is not None and touching: lost.append(s)
        if h is None or an is None or s in lost:
            vec[s] = None; continue
        full = (float(np.linalg.norm(k_ - h)) + float(np.linalg.norm(an - k_))) if k_ is not None else None
        frac = min(0.999, float(np.linalg.norm(an - h)) / full) if full and full > 1 else 0.95
        if sem and sem.get("knee_bend", {}).get(f"leg_{s}") in ("straight", "slight", "deep"):
            want = {"straight": 0.97, "slight": 0.9, "deep": 0.72}[sem["knee_bend"][f"leg_{s}"]]
            if abs(frac - want) > 0.12: frac = want
        d = max(knee_min_d(L), frac * (L["l1"] + L["l2"])); a_ = math.atan2(-(an[1] - h[1]), an[0] - h[0])
        c = max(-1, min(1, (L["l1"] ** 2 + d * d - L["l2"] ** 2) / (2 * L["l1"] * d)))
        A_ = d * np.array([math.cos(a_), math.sin(a_)]); best = None
        for side in (1, -1):                            # the knee bends forward, never backward
            t = a_ + side * math.acos(c); K = L["l1"] * np.array([math.cos(t), math.sin(t)])
            score = knee_fold(K, A_)
            if best is None or score > best[0]: best = (score, t, K)
        _, t, K = best
        vec[s] = (math.degrees(t), math.degrees(math.atan2(A_[1] - K[1], A_[0] - K[0])), A_)
        if sem is not None:
            if sem.get("planted", {}).get(f"leg_{s}") and not sem.get("airborne") and not sem.get("knee_on_ground", {}).get(f"leg_{s}"): planted.append(s)
        else:
            lo = Wd[f"low_{s}"]
            if lo is not None and lo[1] < 12: planted.append(s)
    if planted:
        xs = [Wd[f"ankle_{s}"][0] - vec[s][2][0] - LEGB[s]["hip"][0] for s in planted if Wd[f"ankle_{s}"] is not None]
        if xs: tx = float(np.mean(xs))
        ys = [LEGB[s]["ankle"][1] - vec[s][2][1] - LEGB[s]["hip"][1] for s in planted]
        ty = max(ys)                                   # the higher hip (legs as extended as the key reads); the other planted foot is pressed to the floor by IK
        for s in planted:                              # ...and each planted foot is put ON the floor by IK
            foot_x = LEGB[s]["hip"][0] + tx + vec[s][2][0] if Wd[f"ankle_{s}"] is None else Wd[f"ankle_{s}"][0]
            planted_target = np.array([foot_x, LEGB[s]["ankle"][1]])
            out.setdefault("_pt", {})[s] = planted_target
    def leg_to(s, hp, foot):
        L = LEGB[s]; tgt = foot - hp
        d = min(max(float(np.linalg.norm(tgt)), knee_min_d(L)), L["l1"] + L["l2"] - 1e-3)
        a_ = math.atan2(tgt[1], tgt[0]); c = max(-1, min(1, (L["l1"] ** 2 + d * d - L["l2"] ** 2) / (2 * L["l1"] * d)))
        A_ = d * np.array([math.cos(a_), math.sin(a_)]); best = None
        for side in (1, -1):
            t = a_ + side * math.acos(c); K = L["l1"] * np.array([math.cos(t), math.sin(t)]); score = knee_fold(K, A_)
            if best is None or score > best[0]: best = (score, t, K)
        _, t, K = best; return (math.degrees(t), math.degrees(math.atan2(A_[1] - K[1], A_[0] - K[0])), A_)
    for s, tgt in out.pop("_pt", {}).items():
        vec[s] = leg_to(s, LEGB[s]["hip"] + np.array([tx, ty]), tgt)
    lying = bool(sem.get("lying")) if sem else (abs(world.get("torso", 0.0)) > 55 and Wd["neck"] is not None and Wd["waist"] is not None and Wd["neck"][1] < Wd["waist"][1] - 15)
    if lying and Wd["waist"] is not None and key.get("bias") is not None:
        # lying / fallen: the hip height comes from the waist, and a leg that does not trail away from the head lies along the body
        ty = float((waist - bworld(B["waist"]))[1]) - key["bias"]; planted = []
        body = math.radians(base_ang["torso"] + world.get("torso", 0.0) + 180)
        for s in "rl":
            if vec[s] is not None and abs(norm(math.degrees(math.atan2(vec[s][2][1], vec[s][2][0])) - math.degrees(body))) < 60: continue
            L = LEGB[s]; dd = 0.97 * (L["l1"] + L["l2"]); vec[s] = leg_to(s, np.zeros(2), dd * np.array([math.cos(body), math.sin(body)]))
    out["_ty_legs"] = ty; out["_ty_waist"] = float((waist - bworld(B["waist"]))[1]) if Wd["waist"] is not None else None
    if planted and Wd["waist"] is not None and not lost and key.get("bias") is not None:
        tyw = out["_ty_waist"] - key["bias"]           # waist reading minus this sheet's bias (measured on its calm first frame)
        if tyw < ty - 25:                              # the waist says a deeper crouch than the legs read: trust the waist
            ty = tyw
            for s in planted:
                an_w = Wd[f"ankle_{s}"] if Wd[f"ankle_{s}"] is not None else LEGB[s]["ankle"] + np.array([tx, 0])
                vec[s] = leg_to(s, LEGB[s]["hip"] + np.array([tx, ty]), np.array([an_w[0], LEGB[s]["ankle"][1]]))
    if lost:                                           # lower legs lost in the labels: hip from the waist, feet under the knees
        tx, ty = (waist - bworld(B["waist"])) if Wd["waist"] is not None else (tx, ty); planted = []
        for s in lost:
            L = LEGB[s]; hp = L["hip"] + np.array([tx, ty]); tgt = np.array([Wd[f"knee_{s}"][0], L["ankle"][1]]) - hp
            d = min(max(float(np.linalg.norm(tgt)), knee_min_d(L)), L["l1"] + L["l2"] - 1e-3)
            a_ = math.atan2(tgt[1], tgt[0]); c = max(-1, min(1, (L["l1"] ** 2 + d * d - L["l2"] ** 2) / (2 * L["l1"] * d)))
            A_ = d * np.array([math.cos(a_), math.sin(a_)]); best = None
            for side in (1, -1):
                t = a_ + side * math.acos(c); K = L["l1"] * np.array([math.cos(t), math.sin(t)]); score = knee_fold(K, A_)
                if best is None or score > best[0]: best = (score, t, K)
            _, t, K = best; vec[s] = (math.degrees(t), math.degrees(math.atan2(A_[1] - K[1], A_[0] - K[0])), A_)
    if hip is not None: tx, ty = hip                   # standing action: the hip only breathes around the stance
    for s, foot in (foot_lock or {}).items():          # a planted foot that barely moved stays exactly where it was
        vec[s] = leg_to(s, LEGB[s]["hip"] + np.array([tx, ty]), np.array(foot))
    kneel = [s for s in "rl" if sem and sem.get("knee_on_ground", {}).get(f"leg_{s}")]
    for s in kneel:
        L = LEGB[s]; hp = L["hip"] + np.array([tx, ty]); knee_y = 9.0
        kx = Wd[f"knee_{s}"][0] if Wd.get(f"knee_{s}") is not None else hp[0] + 8
        dx = max(-L["l1"] * 0.9, min(L["l1"] * 0.9, kx - hp[0]))
        need = knee_y + math.sqrt(max(L["l1"] ** 2 - dx * dx, 1.0))      # hip height that lets the thigh reach the knee on the floor
        ty -= hp[1] - need; hp = L["hip"] + np.array([tx, ty])          # kneeling: the hip sits exactly a thigh above the knee on the floor
        K = np.array([hp[0] + dx, knee_y]); A = K + np.array([-0.96 * L["l2"], -2.0])
        vec[s] = (math.degrees(math.atan2(K[1] - hp[1], K[0] - hp[0])), math.degrees(math.atan2(A[1] - K[1], A[0] - K[0])), A - hp)
    for s in "rl":                                     # never put a foot below the floor
        if vec[s] is not None and s not in kneel and not lying: ty = max(ty, LEGB[s]["ankle"][1] - vec[s][2][1] - LEGB[s]["hip"][1] - 2)
        elif vec[s] is not None: ty = max(ty, 4 - vec[s][2][1] - LEGB[s]["hip"][1])   # kneeling / lying: the ankle still stays above the floor
    if lying: ty = max(ty, 12 - LEGB["r"]["hip"][1])   # lying: the hips rest on the floor, not under it
    for s in "rl":
        L = LEGB[s]
        o = "l" if s == "r" else "r"
        if vec[s] is None and vec[o] is not None:
            th = norm(vec[o][0] - LEGB[o]["r1"]) - 4; shn = norm(vec[o][1] - LEGB[o]["r2"] - norm(vec[o][0] - LEGB[o]["r1"]))
        elif vec[s] is None:
            th = world.get("torso", 0.0); shn = 0.0
        else:
            th = norm(vec[s][0] - L["r1"]); shn = norm(vec[s][1] - L["r2"] - th)
        out[f"thigh_{s}"] = th; out[f"shin_{s}"] = shn; out[f"foot_{s}"] = norm(-th - shn)
    out["hip_t"] = (float(tx), float(ty))
    out["ankle_w"] = {s: (LEGB[s]["hip"] + np.array([tx, ty]) + vec[s][2]) for s in "rl" if vec[s] is not None}
    out["planted"] = list(planted) + [s for s in (foot_lock or {}) if s not in planted]
    out["sword_world"] = base_ang["sword"] + world["sword"]
    # an arm raised to head height crosses in front of the face and hair: draw it on top for this key (judged on the rig itself)
    out["grip_l"] = False
    if not NAME.endswith("_back") and J["wrist_l"] is not None and J["grip"] is not None and J["neck"] is not None and J["waist"] is not None:
        tor = float(np.linalg.norm(J["neck"] - J["waist"]))
        if (sem.get("two_hand_grip") if sem else (tor > 1 and float(np.linalg.norm(J["wrist_l"] - J["grip"])) / tor < 0.45)):
            out["grip_l"] = True
            pos, rot = fk(dict(out, _want_rot=True))
            tipo = np.array([bones["sword_tip"]["x"], bones["sword_tip"]["y"]]); blade = math.radians(rot["sword"]) + math.atan2(tipo[1], tipo[0])
            target = pos["sword"] - 14 * np.array([math.cos(blade), math.sin(blade)])
            sh = pos["upperarm_l"]; l1, l2 = ARM["l"]; v = target - sh; d = min(max(float(np.linalg.norm(v)), abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3)
            a_ = math.atan2(v[1], v[0]); c = max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
            best = None
            for side in (1, -1):                       # elbow below the shoulder-hand line
                u = a_ + side * math.acos(c); el = sh + l1 * np.array([math.cos(u), math.sin(u)])
                if best is None or el[1] < best[1][1]: best = (u, el)
            u, el = best; hand = sh + d * np.array([math.cos(a_), math.sin(a_)]); f = math.atan2(hand[1] - el[1], hand[0] - el[0])
            rest_u = math.degrees(math.atan2(*(bw("forearm_l") - bw("upperarm_l"))[::-1])); rest_f = math.degrees(math.atan2(*(bw("hand_l") - bw("forearm_l"))[::-1]))
            torso_w = rot["upperarm_l"] - out.get("upperarm_l", 0.0)
            out["upperarm_l"] = norm(math.degrees(u) - rest_u - torso_w); out["forearm_l"] = norm(math.degrees(f) - rest_f - (torso_w + out["upperarm_l"]))
    wp = fk(out)
    out["arm_front"] = (bool(sem and sem.get("hands_above_head")) or bool(wp["hand_r"][1] > wp["head"][1] - 10)) and not NAME.endswith("_back")   # seen from behind the hair stays on top
    return out
def fk(loc):
    """World positions of the rig's bones for one pose (setup rotations are all zero in this rig)."""
    pos, rot = {}, {}
    def go(name):
        if name in pos: return
        b = bones[name]; par = b.get("parent")
        if par is None: pos[name] = np.zeros(2); rot[name] = 0.0; return
        go(par); r = math.radians(rot[par]); x, y = b.get("x", 0), b.get("y", 0)
        if name == "hip": x += loc["hip_t"][0]; y += loc["hip_t"][1]
        pos[name] = pos[par] + np.array([x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r)])
        rot[name] = rot[par] + loc.get(name, 0.0)
    for nm in ("hand_r", "head", "sword", "sword_tip", "upperarm_l", "forearm_l"): go(nm)
    return (pos, rot) if loc.get("_want_rot") else pos

def ease(cv, f):
    if not cv: return f
    x1, y1, x2, y2 = cv["curve"], cv["c2"], cv["c3"], cv["c4"]
    bz = lambda s, a, b: 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3
    lo, hi = 0.0, 1.0
    for _ in range(40):
        s = (lo + hi) / 2
        if bz(s, x1, x2) < f: lo = s
        else: hi = s
    return bz((lo + hi) / 2, y1, y2)
def unwrap(vals, hints):
    out = [vals[0]]
    for i in range(1, len(vals)):
        d = (vals[i] - out[-1] + 180) % 360 - 180; h = hints.get(str(i - 1))
        if abs(d) >= 90:
            if h == "ccw" and d < 0: d += 360
            if h == "cw" and d > 0: d -= 360
        out.append(out[-1] + d)
    return out

anims = sk["animations"]; joints_out = {}
# new part, only where one angle cannot show it: the left hand closed on the handle = her own right fist, mirrored (same art)
for skin in sk["skins"]:
    A_ = skin["attachments"]
    if "hand_r" in A_ and "hand_l" in A_ and not NAME.endswith("_back"):
        r = A_["hand_r"]["hand_r"]; hl = A_["hand_l"]["hand_l"]
        A_["hand_l"]["hand_l_grip"] = dict(r, path="hand_r", x=round(-r.get("x", 0), 2), rotation=round(-r.get("rotation", 0), 2), scaleX=-r.get("scaleX", 1))
ROT = ["torso", "head", "upperarm_r", "forearm_r", "hand_r", "sword", "upperarm_l", "forearm_l", "skirt", "thigh_r", "shin_r", "foot_r", "thigh_l", "shin_l", "foot_l"]
HAIR_LAG = 0.05
cache = {}
for act in spec["actions"]:
    if ONLY and act["name"] not in ONLY: continue
    name, sh, ks, T, END = act["name"], act["sheet"], act["keys"], act["times"], act["end"]
    if sh not in cache: cache[sh] = load_sheet(sh, sorted({k for a in spec["actions"] if a["sheet"] == sh for k in a["keys"]} | {1}))
    keys = cache[sh]; seq = [pose(keys[k]) for k in ks]; n = len(seq)
    # foot lock: a foot planted in consecutive keys that moved less than a short step keeps the first key's spot, so the
    # generator's frame-to-frame drift does not read as stepping back and forth
    locks = [dict() for _ in range(n)]
    for s_ in "rl":
        ref = None
        for i in range(n):
            a_w = seq[i]["ankle_w"].get(s_); planted_ = s_ in seq[i]["planted"]
            if not planted_ or a_w is None: ref = None; continue
            mv = None
            if i and ks[i] == ks[i - 1] + 1 and SEM.get(sh, {}).get(ks[i]): mv = SEM[sh][ks[i]].get("moves_from_prev", {}).get(f"leg_{s_}_foot")
            stays = (mv == "stays") if mv else None
            if ref is not None and (stays is True and float(np.linalg.norm(a_w - ref)) < 60 or stays is None and float(np.linalg.norm(a_w - ref)) < 24):
                locks[i][s_] = [float(ref[0]), float(ref[1])]
            else: ref = a_w
    if act.get("feetFrom"):                            # standing action: both feet stay on one key's stance the whole time
        if act["feetFrom"] not in keys: keys[act["feetFrom"]] = load_sheet(sh, [act["feetFrom"]] + [1])[act["feetFrom"]]
        st = pose(keys[act["feetFrom"]])
        locks = [{s_: [float(a[0]), float(LEGB[s_]["ankle"][1])] for s_, a in st["ankle_w"].items()} for _ in range(n)]
    for i in range(n):
        if locks[i]: seq[i] = pose(keys[ks[i]], foot_lock=locks[i])
    # the hip moves the way the reader says it moves between consecutive frames (stays / forward / back / up / down): the
    # pixel readings of the legs are noisy enough to slide the whole body back and forth by 60 units between two keys
    SS = SEM.get(sh, {})
    if SS and not act.get("feetFrom"):
        new_h = [np.array(seq[0]["hip_t"], float)]
        for i in range(1, n):
            raw = np.array(seq[i]["hip_t"], float) - np.array(seq[i - 1]["hip_t"], float)
            hs = SS.get(ks[i], {}).get("moves_from_prev", {}).get("hips", "") if ks[i] == ks[i - 1] + 1 else None
            special = lambda f: bool(f) and (f.get("lying") or f.get("airborne") or any(f.get("knee_on_ground", {}).values()))
            if special(SS.get(ks[i])) or special(SS.get(ks[i - 1])): new_h.append(np.array(seq[i]["hip_t"], float)); continue   # own hip rules
            if hs is None: new_h.append(new_h[-1] + raw); continue
            dx = max(0, min(30, raw[0])) if "forward" in hs else min(0, max(-30, raw[0])) if "back" in hs else max(-6, min(6, raw[0]))
            dy = max(-80, min(0, raw[1])) if "down" in hs else max(0, min(80, raw[1])) if "up" in hs else max(-6, min(6, raw[1]))
            new_h.append(new_h[-1] + np.array([dx, dy]))
        for i in range(n):
            if np.allclose(new_h[i], seq[i]["hip_t"], atol=0.5): continue
            fl = dict(locks[i])
            for s_ in seq[i]["planted"]:
                if s_ not in fl and s_ in seq[i]["ankle_w"]: fl[s_] = [float(seq[i]["ankle_w"][s_][0]), float(LEGB[s_]["ankle"][1])]
            seq[i] = pose(keys[ks[i]], foot_lock=fl, hip=(float(new_h[i][0]), float(new_h[i][1])))
    ref = seq[-1 if act.get("rootRef") == "last" else 0]["hip_t"][0]     # the clip starts (Start: ends) where she stands
    if act.get("feetFrom"):
        hx, hy = st["hip_t"]; ref = hx                 # actions sharing one stance share its origin, so Begin/Loop/End line up
        for i in range(n):
            x, y = seq[i]["hip_t"]
            R = act.get("hipRange", 6); seq[i] = pose(keys[ks[i]], foot_lock=locks[i], hip=(hx + max(-6, min(6, x - hx)), hy + max(-R, min(R, y - hy))))
    for i in range(n):                                 # shift the whole clip so it starts where she stands; feet move with it
        seq[i]["hip_t"] = (seq[i]["hip_t"][0] - ref, seq[i]["hip_t"][1])
        seq[i]["ankle_w"] = {s_: np.array([a[0] - ref, a[1]]) for s_, a in seq[i]["ankle_w"].items()}
    nlock = sum(len(l) for l in locks)
    if os.environ.get("RT_DEBUG") and name in os.environ["RT_DEBUG"].split(","):
        for i in range(n): print("  ", name, ks[i], "planted", seq[i]["planted"], {s_: [round(float(v), 1) for v in a] for s_, a in seq[i]["ankle_w"].items()}, "lock", locks[i])

    for k in ks: joints_out[f"{sh}_k{k}"] = {"world": {j: [round(float(v), 2) for v in p] for j, p in keys[k]["W"].items() if p is not None},
                                           "px": {j: [round(float(v), 1) for v in p] for j, p in keys[k]["px"].items() if p is not None}}
    curves = [CURVES[c] for c in act.get("curves", ["E"] * (n - 1))]
    # world sword direction decides the swing path (hints for big ambiguous swings); the hand absorbs the difference
    hints = dict(act.get("swordDir", {}))
    SS = SEM.get(sh, {})
    for i in range(n - 1):
        a_, b_ = ks[i], ks[i + 1]; t_ = None
        if b_ == a_ + 1 and SS.get(b_): t_ = SS[b_].get("sword_turn_from_prev")
        elif b_ == a_ - 1 and SS.get(a_): t_ = {"cw": "ccw", "ccw": "cw"}.get(SS[a_].get("sword_turn_from_prev"))
        if t_ in ("cw", "ccw") and str(i) not in hints: hints[str(i)] = t_
    tl = {}
    sw = unwrap([p["sword_world"] for p in seq], hints)
    # a swing whose blade would pass straight down (through the floor) is the blade turning behind her: foreshorten instead
    flips = [i for i in range(n - 1) if abs(sw[i + 1] - sw[i]) > 120 and any(abs(norm(a + 90)) < 25 for a in np.linspace(sw[i], sw[i + 1], 30)[3:-3])]
    scl = []
    for b in ROT + ["hair_a", "hair_b"]:
        vals = [p[b] for p in seq]
        vals = unwrap(vals, hints if b in ("sword", "upperarm_r") else {})
        lag = HAIR_LAG if b.startswith("hair") else 0
        keys_ = []
        for i in range(n):
            cv = curves[i] if i < n - 1 else E
            t = min(T[i] + lag, END)
            if b == "sword" and i in flips:
                mid = round(T[i] + (T[i + 1] - T[i]) * 0.5, 4)
                keys_ += [{"time": t, "angle": round(vals[i], 2), "curve": "stepped"}, {"time": mid, "angle": round(vals[i + 1], 2), **CURVES["E"]}]
                scl += [dict({"time": T[i], "x": 1, "y": 1}, **CURVES["EI"]), dict({"time": mid, "x": 0.12, "y": 1}, **CURVES["EO"])]
                continue
            if b == "sword": scl.append(dict({"time": T[i], "x": 1, "y": 1}, **cv))
            if i + 1 < n and abs(vals[i + 1] - vals[i]) > 120:   # long swing: in-between keys on the same easing as everything else
                keys_.append({"time": round(t, 4), "angle": round(vals[i], 2)})
                for f in np.arange(1, 8) / 8:
                    keys_.append({"time": round(t + (T[i + 1] - T[i]) * f, 4), "angle": round(vals[i] + (vals[i + 1] - vals[i]) * ease(cv, f), 2)})
            else:
                keys_.append(dict({"time": round(t, 4), "angle": round(vals[i], 2)}, **cv))
        tl[b] = {"rotate": sorted(keys_, key=lambda e: e["time"])}
    tl["sword"]["scale"] = sorted(scl, key=lambda e: e["time"])
    order = [x["name"] for x in sk["slots"]]
    front = ["forearm_r", "upperarm_r", "sword", "hand_r"]; jump = order.index("hair_b") - order.index("hand_r")
    dro, prev = [], None
    for i in range(n):
        f = seq[i]["arm_front"]
        if f != prev:                                   # switch layers halfway into the move that brings the arm up / down
            t = 0 if i == 0 else round(T[i - 1] + (T[i] - T[i - 1]) * 0.5, 4)
            dro.append({"time": t, "offsets": [{"slot": s_, "offset": jump} for s_ in front]} if f else {"time": t})
            prev = f
    if any("offsets" in d for d in dro): out_draw = dro
    else: out_draw = None
    tl["hip"] = {"translate": [dict({"time": T[i], "x": round(seq[i]["hip_t"][0], 2), "y": round(seq[i]["hip_t"][1], 2)}, **(curves[i] if i < n - 1 else E)) for i in range(n)]}
    if not act.get("breathe"):
        LEGS = [f"{p_}_{s_}" for s_ in "rl" for p_ in ("thigh", "shin", "foot")]
        hipk, legk = [], {b: [] for b in LEGS}
        for i in range(n):
            cv = curves[i] if i < n - 1 else E
            hipk.append({"time": T[i], "x": round(seq[i]["hip_t"][0], 2), "y": round(seq[i]["hip_t"][1], 2)})
            for b in LEGS: legk[b].append({"time": T[i], "angle": round(seq[i][b], 2)})
            if i + 1 >= n: continue
            a0, a1 = seq[i]["ankle_w"], seq[i + 1]["ankle_w"]
            for f in (0.2, 0.4, 0.6, 0.8):
                e = ease(cv, f); t = round(T[i] + (T[i + 1] - T[i]) * f, 4)
                hx = seq[i]["hip_t"][0] + (seq[i + 1]["hip_t"][0] - seq[i]["hip_t"][0]) * e
                hy = seq[i]["hip_t"][1] + (seq[i + 1]["hip_t"][1] - seq[i]["hip_t"][1]) * e
                hipk.append({"time": t, "x": round(hx, 2), "y": round(hy, 2)})
                for s_ in "rl":
                    if s_ not in a0 or s_ not in a1:
                        for p_ in ("thigh", "shin", "foot"):
                            b = f"{p_}_{s_}"; legk[b].append({"time": t, "angle": round(seq[i][b] + (seq[i + 1][b] - seq[i][b]) * e, 2)})
                        continue
                    both = s_ in seq[i]["planted"] and s_ in seq[i + 1]["planted"]
                    foot = a0[s_] + (a1[s_] - a0[s_]) * e
                    foot[1] = max(foot[1], LEGB[s_]["ankle"][1] if both else 4.0)          # planted stays at standing height; never under the floor
                    th, sh, ft = leg_solve(s_, LEGB[s_]["hip"] + np.array([hx, hy]), foot)
                    for b, v in ((f"thigh_{s_}", th), (f"shin_{s_}", sh), (f"foot_{s_}", ft)):
                        prev = legk[b][-1]["angle"]; v = prev + norm(v - prev); legk[b].append({"time": t, "angle": round(v, 2)})
        tl["hip"] = {"translate": sorted(hipk, key=lambda k_: k_["time"])}
        for b in LEGS:
            ks_ = sorted(legk[b], key=lambda k_: k_["time"])
            for j in range(1, len(ks_)): ks_[j]["angle"] = round(ks_[j - 1]["angle"] + norm(ks_[j]["angle"] - ks_[j - 1]["angle"]), 2)
            tl[b] = {"rotate": ks_}
    if act.get("breathe"):
        tl["torso"]["translate"] = [{"time": 0, "x": 0, "y": 0, **E}, {"time": round(END / 2, 3), "x": 0, "y": -1.6, **E}, {"time": END, "x": 0, "y": 0}]
    old = anims.get(name, {})
    out = {"bones": tl}
    # keep everything that is not the body's bones: Pod tracks, tints, events; drop the keyframe-drawing slots entirely
    if old.get("slots"):
        sl = {s: v for s, v in old["slots"].items() if not s.startswith("atk_")}
        for s in list(sl):
            v = {k: x for k, x in sl[s].items() if k != "attachment"}   # no drawing swaps: every body slot keeps its setup drawing
            if v: sl[s] = v
            else: del sl[s]
        if sl: out["slots"] = sl
    if act.get("tint"):
        out.setdefault("slots", {})
        for s in [x["name"] for x in sk["slots"] if not x["name"].startswith("atk_") and x["name"] != "pod"]:
            out["slots"][s] = {"color": [dict({"time": t, "color": c}, **E) for t, c in act["tint"]]}
    if act.get("pod"): out["bones"]["pod"] = act["pod"]["bones"]; out.setdefault("slots", {})["pod"] = act["pod"]["slots"]
    if act.get("events"): out["events"] = [{"time": t, "name": e} for t, e in act["events"]]
    if out_draw: out["drawOrder"] = out_draw
    if any(p["grip_l"] for p in seq):
        ks2, prev = [], None
        for i in range(n):
            g_ = seq[i]["grip_l"]
            if g_ != prev:
                t = 0 if i == 0 else round(T[i - 1] + (T[i] - T[i - 1]) * 0.5, 4)
                ks2.append({"time": t, "name": "hand_l_grip" if g_ else "hand_l"}); prev = g_
        if act.get("restore", True) and prev: ks2.append({"time": END, "name": "hand_l"})
        out.setdefault("slots", {}).setdefault("hand_l", {})["attachment"] = ks2
    anims[name] = out
    print(f"{name}: keys {ks}; sword world {[round(a) for a in sw]}, turns behind in {flips}; feet locked {nlock}; hip {[tuple(round(v) for v in p['hip_t']) for p in seq]}")
for a in anims.values():                               # every event a clip fires must be declared in the skeleton
    for e in a.get("events", []): sk.setdefault("events", {}).setdefault(e["name"], {})
json.dump(sk, open(f"{MD}/{NAME}.json", "w"), indent=1)
json.dump(joints_out, open(f"{KD}/joints_rt.json", "w"), indent=1)
