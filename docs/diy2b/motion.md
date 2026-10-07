# 2B motion reconstruction

The existing demo is now tracked in Git. Its original drawings, rig and pre-fix
model are recoverable from seed commit `ae4c9bd`.

The builder accepts absolute paths for the reference rig view, labelled action
frames, action spec, output model and run artifacts. References are read-only;
they are not copied into code worktrees. Install Python dependencies from
`tools/diy2b/requirements.txt` into a project temporary library directory and
pass that directory with `--python-libs` when using the embedded Python runtime.

`build.py` restores the model seed through Git, fits contacts and retained video
samples with `retarget.py` / `continuity.py`, then bakes blade depth turns with
`project_blade.py`. Use the same action references with the front and back base
views. `--artifacts` selects the absolute destination of measured-joint receipts.
The default build deadline is 180 seconds. The input frame directory is never
written by the builder.

Motion changes:

- Retained samples are ordered by time; removing a bad video frame cannot
  disable constraints between its neighbours.
- Each labelled leg keeps its hip/knee/ankle chain. Contacts are fitted together
  with the pelvis using each view's real limb proportions.
- World arm and blade directions are unwrapped before deriving local rotations,
  preventing independently wrapped joints from adding an extra full sword turn.
- Horizontal blade turns are projected continuously through depth with the
  blade axis aligned to its rigid geometry, rather than stepped angle changes.
- Rest poses, shared skill boundaries and the kneeling loop use matching poses.
- Reference attack sample 12 retains its supporting foot: the video prompt and
  visible floor contact describe an overhead lift, not a whole-body jump.

Validation:

`node tools/diy2b/check.mjs <absolute-model-json> <absolute-validate.mjs> <absolute-report-json>`
checks retained-frame motion, rest origins, shared boundaries and hit events,
then samples all rebuilt clips at 60 fps in the actual Spine runtime. Pose gates
cover knees, thigh range, floor contact, head height and joint speed. Blade tip
displacement and floor crossing are checked; its angular direction is excluded
only at the physically undefined edge-on instant, while displacement remains
checked. The original model fails these gates and the repaired front/back pass.

`smoke.mjs <demo-url> <absolute-artifact-directory> [absolute-candidate-checkout]`
exercises the real demo, both model views, the full self-destruct/reboot sequence
and an action deep link. Candidate mode substitutes only this demo's files.
The browser closes on success, failure or its 120-second deadline. The default
view keeps diagnostics closed, exposes selectable text and a fullscreen link;
action links can be copied with the browser's native context menu.
