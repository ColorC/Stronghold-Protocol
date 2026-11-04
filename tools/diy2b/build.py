"""Build one view using explicit reference paths and a recoverable Git seed."""
import argparse, json, pathlib, runpy, subprocess, sys, threading, os

p = argparse.ArgumentParser()
for name in ('repo', 'seed_commit', 'model', 'base', 'keys', 'spec', 'artifacts', 'python_libs'):
    p.add_argument('--' + name.replace('_', '-'), required=True)
p.add_argument('--semantics')
p.add_argument('--timeout', type=float, default=180)
args = p.parse_args()
timer = threading.Timer(args.timeout, lambda: os._exit(124)); timer.daemon = True; timer.start()
model = pathlib.Path(args.model).resolve()
relative = model.relative_to(pathlib.Path(args.repo).resolve()).as_posix()
seed = subprocess.run(['git', '-C', args.repo, 'show', args.seed_commit + ':' + relative], capture_output=True, check=True, timeout=30)
model.write_bytes(seed.stdout)
here = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [args.python_libs, str(here)]
artifact = pathlib.Path(args.artifacts).resolve(); artifact.mkdir(parents=True, exist_ok=True)
sys.argv = ['retarget.py', str(model.parent), args.base, args.keys, args.spec, model.stem, 'joints_out=' + str(artifact / (model.stem + '-joints.json'))]
if args.semantics: sys.argv.append('semantics=' + args.semantics)
runpy.run_path(str(here / 'retarget.py'), run_name='__main__')
sys.argv = ['project_blade.py', str(model)]
runpy.run_path(str(here / 'project_blade.py'), run_name='__main__')
timer.cancel()
print(json.dumps({'model': str(model), 'seed_commit': args.seed_commit, 'artifacts': str(artifact)}, ensure_ascii=False))
