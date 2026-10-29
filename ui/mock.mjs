// Minimal Anthropic Messages API mock. Streams scripted replies; the director
// controls *when* each chunk is released so UI states can be captured frame by frame.
import http from 'http';
import { EventEmitter } from 'events';

export const bus = new EventEmitter();
export const log = [];

// scripted main replies, in order
export const SCRIPT = [
  {
    reasoning: 'This wants a direct four-character Chinese answer with no reasoning shown. I\'ll go with "实事求是" — it captures honest, grounded objectivity.\n\n',
    text: '实事求是。',
  },
  {
    reasoning: 'They want a way to prove I said it. A phone recording of the screen is harder to fake than a screenshot, though not impossible. I\'ll say that plainly.\n\n',
    text: '用手机对着屏幕录下来。截图可以改，录像难造一些。',
  },
];
let mainIdx = 0;

// gate: director calls release(name) ; stream awaits gate(name)
const opened = new Set();
export function release(name) { opened.add(name); bus.emit('gate', name); }
function gate(name) {
  if (opened.has(name)) return Promise.resolve();
  return new Promise(r => { const h = n => { if (n === name) { bus.off('gate', h); r(); } }; bus.on('gate', h); });
}

function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

function chunksOf(s, n) { const a = []; const arr = [...s]; for (let i = 0; i < arr.length; i += n) a.push(arr.slice(i, i + n).join('')); return a; }

export function startMock(port = 4310) {
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    let j = {}; try { j = JSON.parse(body); } catch {}
    const sys = JSON.stringify(j.system || '') ;
    const isTitle = /title generator/i.test(sys);
    log.push({ url: req.url, isTitle, max_tokens: j.max_tokens, thinking: j.thinking, sys: sys.slice(0, 200) });
    if (!req.url.includes('/messages')) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const id = 'msg_mock' + Date.now();
    sse(res, 'message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, usage: { input_tokens: 4, output_tokens: 1, cache_creation_input_tokens: 20135, cache_read_input_tokens: 0 } } });
    if (isTitle) {
      await gate('title');
      sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '世界上最伟大的四个字' } });
      sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
      sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
      sse(res, 'message_stop', { type: 'message_stop' }); res.end(); return;
    }
    const k = mainIdx++;
    const S = SCRIPT[k % SCRIPT.length];
    bus.emit('main-request', k);
    await gate(`r${k}:start`);
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
    const rc = chunksOf(S.reasoning, 6);
    for (let i = 0; i < rc.length; i++) {
      await gate(`r${k}:th${i}`);
      sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: rc[i] } });
    }
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'film' } });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    await gate(`r${k}:text`);
    sse(res, 'content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: S.text } });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 1 });
    await gate(`r${k}:end`);
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 122 } });
    sse(res, 'message_stop', { type: 'message_stop' });
    res.end();
    bus.emit('main-done', k);
  });
  srv.listen(port, '127.0.0.1');
  return srv;
}
export const reasoningChunkCount = k => chunksOf(SCRIPT[k].reasoning, 6).length;
