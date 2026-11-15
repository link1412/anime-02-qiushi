"""Check tool/pose.js reproduces render/camera.py (poses for every clip + autofocus track)."""
import os, sys, json, subprocess, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
os.environ.setdefault('EP1', ROOT)
sys.path.insert(0, os.path.join(ROOT, 'render'))
import camera

sb = camera.load()
rig = camera.Rig(sb)
seeds = sorted({int(c.get('seed', 0)) for c in sb['clips']})
noise = {s: {n: camera.Noise1D(b + 100 * s, fr, am).params() for n, b, fr, am in camera.NOISES} for s in seeds}
samples = []
rng = np.random.default_rng(0)
for ci, c in enumerate(rig.clips):
    ts = list(np.linspace(-0.05, c.dur + 0.05, 400)) + list(rng.uniform(0, c.dur, 100))
    ts += [a for a, b in c.macro] + [b for a, b in c.macro if b < 50] + ([c.stop, c.stop + 0.03] if c.stop else [])
    samples += [(ci, float(t)) for t in ts]
py = []
for ci, t in samples:
    p = rig.clips[ci].pose(t)
    py.append(list(p['C']) + list(p['right']) + list(p['down']) + list(p['fwd']) + [p['fx'], float(p['macro']), p['dist']])
inp = {'sb': sb, 'anchors': camera.ANCHORS, 'noise': noise,
       'consts': {'FPS': camera.FPS, 'PP': camera.PP, 'FX_MAIN': camera.FX_MAIN, 'FX_MACRO': camera.FX_MACRO, 'LENS_DX': camera.LENS_DX, 'LENS_DY': camera.LENS_DY, 'LENS_XFADE': camera.LENS_XFADE},
       'samples': samples}
js = r"""
import fs from 'fs';
import { Rig } from '%s';
const inp = JSON.parse(fs.readFileSync(process.argv[2]));
const rig = new Rig(inp.sb, inp.anchors, inp.noise, inp.consts);
const out = inp.samples.map(([ci, t]) => { const p = rig.clips[ci].pose(t);
  return [...p.C, ...p.right, ...p.down, ...p.fwd, p.fx, p.macro ? 1 : 0, p.dist]; });
fs.writeFileSync(process.argv[3], JSON.stringify({ poses: out, focus: Array.from(rig.focus), nframes: rig.nframes }));
""" % os.path.join(HERE, 'pose.js')
with tempfile.TemporaryDirectory() as d:
    open(f'{d}/in.json', 'w').write(json.dumps(inp))
    open(f'{d}/t.mjs', 'w').write(js)
    subprocess.run(['node', f'{d}/t.mjs', f'{d}/in.json', f'{d}/out.json'], check=True)
    res = json.load(open(f'{d}/out.json'))
a = np.array(py); b = np.array(res['poses'])
fa = rig.focus; fb = np.array(res['focus'])
print('samples', len(a), 'pose max abs diff', np.abs(a - b).max(), '| frames', rig.nframes, res['nframes'],
      '| focus max rel diff', (np.abs(fa - fb) / np.abs(fa)).max())
assert rig.nframes == res['nframes'] and len(fa) == len(fb)
assert np.abs(a - b).max() < 1e-7 and (np.abs(fa - fb) / np.abs(fa)).max() < 1e-9
print('OK')
