"""List the menubar assets the film needs (clock strings, battery levels) -> build/menubar_needs.json.
Then run: node ui/menubar.mjs"""
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
import camera, compose

clocks, batts = set(), set()
for f in range(camera.RIG.nframes):
    c, u = camera.RIG.locate(f)
    clocks.add(compose.clock_string_at(c, u))
    b, charging = compose.battery_state(f)
    if (b, charging) != (89, True):
        batts.add(b)
out = {'clocks': sorted(clocks), 'batteries': sorted(batts)}
json.dump(out, open(f'{compose.B}/menubar_needs.json', 'w'), ensure_ascii=False, indent=1)
print(len(clocks), 'clock strings;', 'batteries', sorted(batts))
