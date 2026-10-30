// Film stand-in "computer" MCP server for the isolated capture instance: it only appends each call to
// /tmp/film2/computer.log and answers "ok"-style text. It never touches the real keyboard, mouse or screen.
// The real Spotlight/Maps picture in clip Z comes from build/ztake (recorded separately by take.py).
import fs from 'fs';
import readline from 'readline';
const TOOLS = [
  { name: 'key', description: 'Press a key or key combination, e.g. "cmd+space".', inputSchema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] } },
  { name: 'type', description: 'Type text with the keyboard.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'click', description: 'Click at screen coordinates.', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
];
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'computer', version: '1.0.0' } } });
  if (m.method === 'tools/list') return out({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  if (m.method === 'tools/call') {
    const { name, arguments: a = {} } = m.params || {};
    try { fs.appendFileSync('/tmp/film2/computer.log', JSON.stringify({ t: Date.now(), name, a }) + '\n'); } catch {}
    const text = name === 'key' ? `Pressed ${a.keys}` : name === 'type' ? `Typed "${a.text}"` : name === 'click' ? `Clicked (${a.x}, ${a.y})` : 'ok';
    return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } });
  }
  if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, result: {} });
});
