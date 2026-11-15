#!/bin/bash
# Restart the isolated OpenCode instance used for capture (port 4398) with empty data/state.
# Config (Mythos 10 + ululululultra) lives in /tmp/film2cfg; models cache in /tmp/film2cache is kept.
# All HTTP(S) goes to the local mitm stub (ui/mitm.mjs on 4321), never to the internet.
set -u
pkill -f "opencode serve --pure --port 4398" ; sleep 1
rm -rf /tmp/film2data /tmp/film2state
mkdir -p /tmp/film2data /tmp/film2state /tmp/film2 /tmp/film2cfg/opencode
HERE="$(cd "$(dirname "$0")" && pwd)"
# config (bash allowed, log-only "computer" MCP) and the stand-in caffeinate/pmset, PATH-first for this instance only
python3 - "$HERE" <<'PY'
import json, pathlib, sys
here = pathlib.Path(sys.argv[1])
config = json.loads((here / 'film2cfg.opencode.json').read_text())
config['mcp']['computer']['command'] = ['node', str(here / 'zrec/mcp_computer.mjs')]
pathlib.Path('/tmp/film2cfg/opencode/opencode.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
PY
rm -rf /tmp/film2bin && cp -R "$HERE/fakebin" /tmp/film2bin && chmod +x /tmp/film2bin/*
cd /tmp
env -u OPENCODE_DISABLE_EMBEDDED_WEB_UI -u OPENCODE_CLIENT -u __CFBundleIdentifier XDG_CONFIG_HOME=/tmp/film2cfg XDG_DATA_HOME=/tmp/film2data XDG_STATE_HOME=/tmp/film2state XDG_CACHE_HOME=/tmp/film2cache PATH="/tmp/film2bin:$PATH" \
  HTTPS_PROXY=http://127.0.0.1:4321 HTTP_PROXY=http://127.0.0.1:4321 NO_PROXY=127.0.0.1,localhost,::1 NODE_TLS_REJECT_UNAUTHORIZED=0 \
  OPENCODE_SERVER_USERNAME=opencode OPENCODE_SERVER_PASSWORD=film \
  nohup opencode serve --pure --port 4398 > /tmp/film2/oc2.log 2>&1 < /dev/null &
disown
for i in $(seq 1 40); do curl -s -o /dev/null -u opencode:film http://127.0.0.1:4398/ && { echo "4398 up"; exit 0; }; sleep 0.5; done
echo "4398 did not come up"; exit 1
