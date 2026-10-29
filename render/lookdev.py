"""Look-development renders for any clip with a stand-in panel image (no need for that clip's
real UI capture / menubar assets). Renders consecutive frames so temporal NR and AE behave.

  python3 render/lookdev.py --clip C --t0 5.8 --t1 9.0 --save-every 6 --tag lighter
  python3 render/lookdev.py --clip A --frames-local 30.2 --isp 1,2 --tag moire

Panel stand-in: --ui (a build/ui_frames name) + --clock (a string present in build/clock/meta.json).
"""
import os, sys, math, time, argparse, json
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import cv2
import render as R
import camera, compose

ap = argparse.ArgumentParser()
ap.add_argument('--clip', default='C')
ap.add_argument('--t0', type=float, default=None)
ap.add_argument('--t1', type=float, default=None)
ap.add_argument('--frames-local', default='', help='comma list of clip-local times (each gets TNR warm-up)')
ap.add_argument('--save-every', type=int, default=1)
ap.add_argument('--ui', default='u_00583.png', help="'auto' = the clip's own UI frames; 'hold:6.4' = own frames, frozen after 6.4 s")
ap.add_argument('--clock', default='10月30日 00:31:58')
ap.add_argument('--isp', default='2')
ap.add_argument('--grime', type=float, default=None)
ap.add_argument('--tag', default='look')
ap.add_argument('--warm', type=int, default=4)
a = ap.parse_args()
if a.grime is not None:
    R.GRIME = a.grime

clip = next(c for c in camera.RIG.clips if c.id == a.clip)
HOLD = float(a.ui.split(':')[1]) if a.ui.startswith('hold:') else None
P0 = None if (a.ui == 'auto' or HOLD is not None) else R._lut[compose.panel_cached(a.ui, a.clock)]
_pc = {}


def panel(f):
    if P0 is not None:
        return P0
    if HOLD is None:
        return R.panel_for_frame(f)
    # the clip's own UI frames up to HOLD s (clip-local), then hold the last one (for clips
    # made longer than the current UI capture)
    u = min((f - clip.f0) / camera.FPS, HOLD)
    g = clip.f0 + int(round(u * camera.FPS))
    k = (compose.ui_name(g), compose.clock_string_at(clip, u), compose.battery_state(g))
    if k not in _pc:
        _pc.clear(); _pc[k] = R._lut[compose.panel_cached(*k)]
    return _pc[k]
out_dir = f'{R.ROOT}/build/lookdev/{a.tag}'
os.makedirs(out_dir, exist_ok=True)


def target(f):
    c, u = camera.RIG.locate(f)
    L = R.scene_luma(f, panel=panel(f)) + R.flame_meter(f)
    tg = float(np.clip(R.AE_TARGET / max(L, 1e-4), 0.55, 3.4))
    return min(tg, R.MACRO_EXPO_CAP) if c.pose(u)['macro'] else tg


if a.frames_local:
    runs = []
    for x in a.frames_local.split(','):
        f = clip.f0 + int(round(float(x) * camera.FPS))
        runs.append((max(clip.f0, f - a.warm), f + 1, {f}))
else:
    f0 = clip.f0 + int(round(a.t0 * camera.FPS)); f1 = clip.f0 + int(round(a.t1 * camera.FPS))
    runs = [(max(clip.f0, f0 - a.warm), f1 + 1, set(range(f0, f1 + 1, a.save_every)))]

for isp in [int(v) for v in a.isp.split(',')]:
    R.ISP = isp
    for s, e, keep in runs:
        st = {}
        ex = None
        for f in range(s, e):
            tg = target(f)
            ex = tg if ex is None else ex * math.exp(math.log(tg / ex) * (1 - math.exp(-(1 / camera.FPS) / 0.33)))
            if f not in keep and isp < 2:
                continue
            t0 = time.time()
            im = R.render(f, ex, panel=panel(f), state=st)
            if f in keep:
                u = (f - clip.f0) / camera.FPS
                p = f'{out_dir}/{a.clip}_{u:06.2f}_isp{isp}.png'
                cv2.imwrite(p, cv2.cvtColor(im, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_PNG_COMPRESSION, 1])
                print(f'{p}  expo {ex:.3f}  {time.time() - t0:.1f}s', flush=True)
