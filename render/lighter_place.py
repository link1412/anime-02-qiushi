"""Where to put the lighter so its reflection sits in a frame corner (read-only: prints, never
edits storyboard.json). Rerun after changing a clip's camera keyframes.

    python3 render/lighter_place.py C                 # default: base at (35, 150) px at strike+1.1 s
    python3 render/lighter_place.py C --u 35 --v 150 --at "C_ENTER+2.4" --dist 460

Prints the "pos" to paste into the clip's "lighter", then checks where the flame base, tip and
ember land in every 0.25 s of the lit interval (u < 0 = cut by the left edge).
"""
import os, sys, argparse
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import camera, lighter

ap = argparse.ArgumentParser()
ap.add_argument('clip')
ap.add_argument('--u', type=float, default=35)
ap.add_argument('--v', type=float, default=150)
ap.add_argument('--at', default=None, help='time expression (default: strike + 1.1 s)')
ap.add_argument('--dist', type=float, default=460, help='flame distance from the screen, mm')
a = ap.parse_args()

clip = next(c for c in camera.RIG.clips if c.id == a.clip)
cfg = dict(clip.raw.get('lighter') or {})
if not cfg:
    raise SystemExit(f'clip {a.clip} has no "lighter"')
t = camera.tval(a.at) if a.at else camera.tval(cfg['strike']) + 1.1
p = clip.pose(t)
xn, yn = (a.u - 960) / p['fx'], (a.v - 540) / p['fx']
D = p['right'] * xn + p['down'] * yn + p['fwd']
s = (a.dist - p['C'][2]) / D[2]
M = p['C'] + s * D                         # point on the mirror image, behind the glass
pos = [round(float(M[0]), 1), round(float(M[1]), 1), -a.dist]
print(f'"pos": {pos}    (solved at t={t:.2f}s, currently {cfg.get("pos")})')
cfg['pos'] = pos
t0, t1 = camera.tval(cfg['strike']), camera.tval(cfg.get('exhale') or cfg['out'])
for tt in np.arange(t0, t1 + 1e-6, 0.25):
    st = lighter.state(cfg, tt, camera.tval)
    if not st:
        continue
    q = clip.pose(tt)
    u, v, z = lighter.project(q, lighter.mirror(st['pos']), q['fx'], 1920, 1080)
    hp = st['h'] * q['fx'] / z
    eu, ev, _ = lighter.project(q, lighter.mirror(st['ember_pos']), q['fx'], 1920, 1080)
    fl = f'flame base ({u:5.0f},{v:5.0f}) tip y {v - hp:5.0f}' if st['flame'] > 0 else 'flame off'.ljust(34)
    print(f'  t={tt:6.2f}  {fl}   ember ({eu:5.0f},{ev:5.0f})')
