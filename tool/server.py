"""Local preview server for the storyboard tool.

    python3 tool/server.py            # http://127.0.0.1:8765

Serves the web preview, a whitelisted set of project files, and a small JSON API:
  GET  /api/state         storyboard + everything the browser needs to rebuild the camera
  POST /api/storyboard    validate (builds the Python rig) + backup + save
  POST /api/phys?f=N      physical render of one frame with render/render.py (clip A only)
"""
import os, sys, json, time, shutil, subprocess, threading, mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
os.environ.setdefault('EP1', ROOT)
sys.path.insert(0, os.path.join(ROOT, 'render'))

import numpy as np
import camera
import compose

PORT = int(os.environ.get('PORT', 8765))
SB_PATH = os.path.join(ROOT, 'storyboard.json')
HIST = os.path.join(ROOT, 'storyboard_history')
CACHE = os.path.join(ROOT, 'cache')
ALLOWED = ('/tool/', '/build/ui_frames/', '/build/clock/', '/build/battery/', '/build/audio.wav', '/cache/')
_phys_lock = threading.Lock()


def desktop_panel():
    """notch strip + desktop (wallpaper, menubar without clock) + window shadow; no window."""
    out = os.path.join(CACHE, 'desktop_panel.png')
    src = [os.path.join(ROOT, p) for p in ('ref/screen_now.png', 'ref/d1.png', 'render/compose.py')]
    if os.path.exists(out) and all(os.path.getmtime(out) > os.path.getmtime(s) for s in src):
        return out
    import cv2
    d = compose.desktop_base().astype(np.float32)
    m, sh, border = compose.window_mask_and_shadow()
    d *= (1 - sh[..., None])
    P = np.zeros((compose.PANEL_H, compose.PANEL_W, 3), np.uint8)
    P[compose.NOTCH:] = np.clip(d + 0.5, 0, 255).astype(np.uint8)
    os.makedirs(CACHE, exist_ok=True)
    cv2.imwrite(out, cv2.cvtColor(P, cv2.COLOR_RGB2BGR))
    return out


def state():
    sb = json.load(open(SB_PATH))
    seeds = sorted({int(c.get('seed', 0)) for c in sb['clips']} | set(range(64)))
    noise = {}
    for s in seeds:
        noise[s] = {n: camera.Noise1D(b + 100 * s, fr, am).params() for n, b, fr, am in camera.NOISES}
    idx = json.load(open(os.path.join(ROOT, 'build/ui_index.json')))
    clock = json.load(open(os.path.join(ROOT, 'build/clock/meta.json')))
    import importlib, render as R
    importlib.reload(camera); importlib.reload(R)
    expo = R.exposure_cached()
    return {
        'storyboard': sb,
        'anchors': camera.ANCHORS,
        'consts': {'FPS': camera.FPS, 'PP': camera.PP, 'FX_MAIN': camera.FX_MAIN, 'FX_MACRO': camera.FX_MACRO},
        'noise': noise,
        'ui': {'startFrame': idx['startFrame'], 'frames': idx['frames']},
        'clock': clock,
        'exposure': expo,
        'geom': {'PANEL_W': compose.PANEL_W, 'PANEL_H': compose.PANEL_H, 'NOTCH': compose.NOTCH,
                 'WIN_X': compose.WIN_X, 'WIN_Y': compose.WIN_Y, 'WIN_W': 2210, 'WIN_H': 1389,
                 'RADIUS': compose.RADIUS, 'CLOCK_X0': 3004 - 214, 'BAR': [2600, 0, 424, 24]},
        'battery_imgs': sorted(int(x[:-4]) for x in os.listdir(os.path.join(ROOT, 'build/battery')) if x.endswith('.png')) if os.path.isdir(os.path.join(ROOT, 'build/battery')) else [],
        'render': {'AE_TARGET': R.AE_TARGET, 'MACRO_EXPO_CAP': R.MACRO_EXPO_CAP, 'MACRO_SHUTTER': R.MACRO_SHUTTER, 'EXPO': R.EXPO,
                   'LAMP': [-0.25, -0.27, -0.93], 'WINDOW': [0.16, -0.21, -0.96]},
        'desk': '/cache/desktop_panel.png?v=%d' % int(os.path.getmtime(desktop_panel())),
    }


def save_storyboard(sb):
    camera.Rig(sb)  # raises on bad expressions / keys
    os.makedirs(HIST, exist_ok=True)
    if os.path.exists(SB_PATH):
        shutil.copy2(SB_PATH, os.path.join(HIST, time.strftime('storyboard-%Y%m%d-%H%M%S.json')))
    tmp = SB_PATH + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(sb, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, SB_PATH)


def phys(f):
    out_dir = os.path.join(CACHE, 'phys')
    os.makedirs(out_dir, exist_ok=True)
    env = dict(os.environ, OUTDIR=out_dir, EP1=ROOT)
    with _phys_lock:
        r = subprocess.run([sys.executable, 'render.py', '--frames', str(f)], cwd=os.path.join(ROOT, 'render'),
                           env=env, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-2000:])
    return '/cache/phys/f_%05d.png?v=%d' % (f, int(time.time()))


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        if a and isinstance(a[0], str) and '/api/' in a[0]:
            sys.stderr.write('%s\n' % (fmt % a))

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        if p in ('/', '/index.html'):
            p = '/tool/index.html'
        if p == '/api/state':
            try:
                return self._json(state())
            except Exception as e:
                return self._json({'error': repr(e)}, 500)
        if not p.startswith(ALLOWED) or '..' in p:
            return self.send_error(404)
        fp = os.path.join(ROOT, p.lstrip('/'))
        if not os.path.isfile(fp):
            return self.send_error(404)
        ctype = mimetypes.guess_type(fp)[0] or 'application/octet-stream'
        if fp.endswith('.js') or fp.endswith('.mjs'):
            ctype = 'text/javascript; charset=utf-8'
        size = os.path.getsize(fp)
        rng = self.headers.get('Range')
        with open(fp, 'rb') as fh:
            if rng and rng.startswith('bytes='):
                a, _, b = rng[6:].partition('-')
                a = int(a or 0); b = int(b) if b else size - 1
                fh.seek(a); data = fh.read(b - a + 1)
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {a}-{b}/{size}')
            else:
                data = fh.read()
                self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(len(data)))
            cache = 'no-cache' if p.startswith('/tool/') else 'max-age=3600'
            self.send_header('Cache-Control', cache)
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass   # browser cancelled (seek / reload)

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        try:
            if u.path == '/api/storyboard':
                save_storyboard(json.loads(body))
                return self._json({'ok': True, 'saved': time.strftime('%H:%M:%S')})
            if u.path == '/api/phys':
                f = int(parse_qs(u.query)['f'][0])
                return self._json({'ok': True, 'url': phys(f)})
        except Exception as e:
            return self._json({'ok': False, 'error': str(e)}, 400)
        self.send_error(404)


if __name__ == '__main__':
    desktop_panel()
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    print(f'preview: http://127.0.0.1:{PORT}/', flush=True)
    srv.serve_forever()
