"""Real take for clip Z: Mythos 'computer use' opens Spotlight -> Maps -> searches breakfast near West Bund.
Records the built-in display (avfoundation screen 1, 60 fps, no cursor) and logs every input with its time.
Before: Maps location access OFF (no current location), Maps last region = West Bund, Maps window frame set.
usage: python3 take.py <outdir> <backdrop: film desktop+window, 3024x1890 png>"""
import sys, os, time, json, subprocess, signal
import Quartz, AppKit
OUT, BG = sys.argv[1], sys.argv[2]
import cv2
_bg = cv2.imread(BG)
if _bg is None or _bg.shape[:2] != (1890, 3024):
    raise SystemExit(f'backdrop {BG} missing or not 3024x1890: refusing to record the real desktop')
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
log = []
T0 = None
def mark(kind, **kw):
    log.append({'t': round(time.time() - T0, 4), 'kind': kind, **kw})

K = {'space': 49, 'return': 36, 'm': 46, 'a': 0, 'p': 35, 'f': 3, 'q': 12, 'b': 11, 'r': 15, 'e': 14, 'k': 40, 's': 1, 't': 17, 'esc': 53}
CMD = Quartz.kCGEventFlagMaskCommand
def key(name, cmd=False):
    for down in (True, False):
        e = Quartz.CGEventCreateKeyboardEvent(None, K[name], down)
        Quartz.CGEventSetFlags(e, CMD if cmd else 0)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
        time.sleep(0.012)
    mark('key', key=name, cmd=cmd)
def type_(s, dt=0.085):
    for ch in s:
        key(ch); time.sleep(dt)
def mouse_to(x1, y1, dur=0.6):
    p = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None)); x0, y0 = p.x, p.y
    n = max(2, int(dur * 120))
    for i in range(1, n + 1):
        u = i / n; m = u * u * u * (10 - 15 * u + 6 * u * u)
        x, y = x0 + (x1 - x0) * m, y0 + (y1 - y0) * m
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (x, y), 0))
        mark('pointer', x=round(x, 2), y=round(y, 2))
        time.sleep(dur / n)
def click():
    p = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    for t in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, t, (p.x, p.y), 0)); time.sleep(0.05)
    mark('click', x=p.x, y=p.y)
def wins():
    out = []
    for w in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID):
        b = w['kCGWindowBounds']
        if b['X'] < 0: continue            # external display
        out.append({'owner': w.get('kCGWindowOwnerName'), 'layer': w.get('kCGWindowLayer'), 'id': w['kCGWindowNumber'],
                    'b': [b['X'], b['Y'], b['Width'], b['Height']]})
    return out
def snap_windows(tag):
    mark('windows', tag=tag, w=[w for w in wins() if w['owner'] in ('Spotlight', '聚焦', 'Maps', '地图')])

# --- prepare: English input, other apps hidden, backdrop up
subprocess.run(['python3', '/tmp/film2/tis.py', 'com.apple.keylayout.ABC'])
ws = AppKit.NSWorkspace.sharedWorkspace()
hidden = []
for a in ws.runningApplications():
    if a.activationPolicy() == AppKit.NSApplicationActivationPolicyRegular and a.bundleIdentifier() not in ('com.apple.finder',) and not a.isHidden():
        if a.hide(): hidden.append(a)
bd = subprocess.Popen(['python3', os.path.join(HERE, 'backdrop.py'), BG])
time.sleep(2.5)
ff = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-capture_cursor', '0', '-framerate', '60',
                       '-i', '1:none', '-c:v', 'prores_videotoolbox', '-profile:v', '4', '-y', os.path.join(OUT, 'take.mov')],
                      stdin=subprocess.PIPE)
T0 = time.time()
mark('rec_start')
try:
    time.sleep(2.5)
    key('space', cmd=True); time.sleep(0.55); snap_windows('spotlight')
    type_('map'); time.sleep(0.45); snap_windows('spotlight_typed')
    key('return')
    for _ in range(80):                       # wait for the Maps window
        time.sleep(0.1)
        if any(w['owner'] in ('Maps', '地图') and w['layer'] == 0 for w in wins()): break
    mark('maps_window'); time.sleep(1.6); snap_windows('maps')
    key('f', cmd=True); time.sleep(0.4)
    type_('breakfast', 0.075); time.sleep(0.35)
    key('return'); time.sleep(2.6); snap_windows('results')
    mouse_to(1040 + 150, 230 + 118, 0.65); time.sleep(0.25)
    click(); time.sleep(3.2); snap_windows('place')
    key('q', cmd=True); time.sleep(1.8); snap_windows('closed')
finally:
    mark('rec_stop')
    ff.stdin.write(b'q'); ff.stdin.flush(); ff.wait(timeout=20)
    bd.terminate()
    subprocess.run(['python3', '/tmp/film2/tis.py', 'com.apple.inputmethod.SCIM.ITABC'])
    for a in hidden: a.unhide()
    json.dump(log, open(os.path.join(OUT, 'log.json'), 'w'), indent=1)
    print('done', len(log), 'events')
