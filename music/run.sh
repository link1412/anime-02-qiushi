#!/bin/bash
# Render the film score on the Mac mini (Keyscape lives there) and bring build/music.wav back.
#   bash music/run.sh [--plan] [--only aria,var16] [--force]
# Uses the CURRENT local build/timeline.json + music/cues.json, so re-run after every re-cut.
# Everything stays inside ~/ep1/music on the mini (its ~/ep1/build is the video render's, untouched).
# khost is compiled here (the mini's CommandLineTools Swift is broken: duplicate SwiftBridging modulemap).
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${HOST:-link}
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 $HOST"
mkdir -p music/bin
if [ ! -x music/bin/khost ] || [ music/khost.swift -nt music/bin/khost ]; then
  echo "compiling khost"; swiftc -O -target arm64-apple-macos13 music/khost.swift -o music/bin/khost
fi
$SSH 'mkdir -p ~/ep1/music/work ~/ep1/music/bin ~/ep1/music/scores ~/ep1/music/cache'
rsync -a music/khost.swift music/keyscape.py music/score.py music/build.py music/cues.json "$HOST:ep1/music/"
rsync -a music/scores/ "$HOST:ep1/music/scores/"
rsync -a music/bin/khost "$HOST:ep1/music/bin/khost"
rsync -a build/timeline.json "$HOST:ep1/music/work/timeline.json"
$SSH "cd ~/ep1/music && ../venv/bin/python build.py --timeline work/timeline.json --out work/music.wav $*"
case " $* " in *" --plan "*) exit 0;; esac
scp -q "$HOST:ep1/music/work/music.wav" "$HOST:ep1/music/work/music_report.json" build/
echo "-> build/music.wav (mix into the film sound with: python3 render/sound.py)"
