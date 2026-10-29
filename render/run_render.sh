#!/bin/bash
# Full render on the Mac mini, detached from SSH. ISP v2 uses temporal NR, so each worker gets a
# contiguous frame range (not an interleaved one); render.py warms up 3 frames at range starts.
# Existing frames are skipped, so rerunning resumes.  Logs/PIDs: $EP1/logs/
set -euo pipefail
EP1=${EP1:-/path/to/ep1}
N=${N:-8}
PY=${PY:-$EP1/venv/bin/python3}
cd "$EP1"
mkdir -p logs build/frames
NF=$("$PY" -c "import sys; sys.path.insert(0,'render'); import camera; print(camera.RIG.nframes)")
"$PY" render/smudge.py >/dev/null 2>&1 || true        # build/smudge.png (deterministic)
"$PY" -c "import sys; sys.path.insert(0,'render'); import render; render.exposure_track()"   # AE once, before the workers
: > logs/pids.txt
for i in $(seq 0 $((N - 1))); do
  a=$(( NF * i / N )); b=$(( NF * (i + 1) / N ))
  nohup "$PY" render/render.py --start $a --end $b > logs/w$i.log 2>&1 < /dev/null &
  echo "$! $a $b" >> logs/pids.txt
done
echo "frames $NF, $N workers; pids in logs/pids.txt; output build/frames"
