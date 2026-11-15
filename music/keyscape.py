#!/usr/bin/env python3
"""Keyscape patch -> AU fullState (runs on the Mac mini; stdlib only).

  keyscape.py list [filter]                      list factory patches
  keyscape.py state "<patch name>" out.plist     build a fullState with that patch in part 1

The factory .db files are a simple archive: an XML <FileSystem> index (name/offset/size), then the
payload; a .prt_key is a <KeyscapePart><SynthEngine>…</SynthEngine></KeyscapePart> block. The AU
state ("data0") is a SynthMaster multi with 8 <SynthSubEngine><SynthEngine>…; we swap the first
part's SynthEngine for the patch's. The template is khost's own default state (khost --dump-state).
"""
import os, plistlib, re, sys

LIB = os.path.expanduser('~/Library/Application Support/Spectrasonics/STEAM/Keyscape/Settings Library/Patches/Factory')
HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, 'work', 'default_state.plist')


def index():
    out = []
    for db in sorted(os.listdir(LIB)):
        if not db.endswith('.db'):
            continue
        p = os.path.join(LIB, db)
        with open(p, 'rb') as f:
            head = f.read(4 << 20)
        end = head.index(b'</FileSystem>') + len(b'</FileSystem>\n')
        path = []
        for m in re.finditer(rb'<DIR name="([^"]*)">|</DIR>|<FILE name="([^"]*)\.prt_key" offset="(\d+)" size="(\d+)"/>', head[:end]):
            if m.group(0).startswith(b'</DIR'):
                path.pop()
            elif m.group(1) is not None:
                path.append(m.group(1).decode())
            else:
                out.append(dict(name=m.group(2).decode().replace('&#39;', "'").replace('&amp;', '&'),
                                db=p, offset=end + int(m.group(3)), size=int(m.group(4)), dir='/'.join(path)))
    return out


def patch_xml(name):
    hits = [e for e in index() if e['name'].strip() == name.strip()]
    if not hits:
        sys.exit(f'patch not found: {name!r} (try: keyscape.py list)')
    e = hits[0]
    with open(e['db'], 'rb') as f:
        f.seek(e['offset']); x = f.read(e['size'])
    assert x.lstrip().startswith(b'<KeyscapePart'), x[:40]
    return x


def build_state(name, out):
    st = plistlib.load(open(TEMPLATE, 'rb'))
    multi = st['data0']
    p = patch_xml(name)
    a = p.index(b'<SynthEngine'); b = p.rindex(b'</SynthEngine>') + len(b'</SynthEngine>')
    eng = p[a:b]
    s = multi.index(b'<SynthSubEngine'); s = multi.index(b'<SynthEngine', s)
    e = multi.index(b'</SynthEngine>', s) + len(b'</SynthEngine>')
    st['data0'] = multi[:s] + eng + multi[e:]
    with open(out, 'wb') as f:
        plistlib.dump(st, f)
    print(f'state: {name!r} -> {out} ({len(st["data0"])} bytes)')


if __name__ == '__main__':
    if sys.argv[1] == 'list':
        flt = (sys.argv[2] if len(sys.argv) > 2 else '').lower()
        for e in index():
            if flt in (e['dir'] + '/' + e['name']).lower():
                print(f"{e['dir']}/{e['name']}")
    elif sys.argv[1] == 'state':
        build_state(sys.argv[2], sys.argv[3])
