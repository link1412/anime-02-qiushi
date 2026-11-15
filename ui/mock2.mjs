// Anthropic Messages API mock, v2: scripted turns (thinking / text / tool_use / HTTP errors),
// title + compaction requests, and gates so the director decides when each piece streams.
import http from 'http';
import fs from 'fs';
import { EventEmitter } from 'events';

export const bus = new EventEmitter();
const opened = new Set();
export function release(name) { opened.add(name); bus.emit('gate', name); }
export function isOpen(name) { return opened.has(name); }
function gate(name) {
  if (!name || opened.has(name)) return Promise.resolve();
  return new Promise(r => { const h = n => { if (n === name) { bus.off('gate', h); r(); } }; bus.on('gate', h); });
}
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
export const chunksOf = (s, n) => { const a = [], arr = [...s]; for (let i = 0; i < arr.length; i += n) a.push(arr.slice(i, i + n).join('')); return a; };

let toolSeq = 0;
export const stats = { main: 0, title: 0, compact: 0, requests: [] };

// turn: { id, blocks:[{type:'thinking'|'text', text, chunk?, gated?} | {type:'tool', name, input}],
//         stop?: 'end_turn'|'tool_use', usage?: {...}, error?: {status, type, message}, startGate?: bool }
export function startMock({ port = 4320, script, title = '世界上最伟大的四个字', logFile = '/tmp/film2/mock.log', compactSummary }) {
  let mainIdx = 0;
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    let j = {}; try { j = JSON.parse(body); } catch {}
    const sys = JSON.stringify(j.system || '');
    const lastUser = JSON.stringify((j.messages || []).slice(-1));
    const isTitle = /title generator/i.test(sys);
    const isCompact = !isTitle && /summar/i.test(lastUser) && /(continu|conversation)/i.test(lastUser) && (j.tools || []).length === 0;
    try { fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), url: req.url, model: j.model, isTitle, isCompact, ntools: (j.tools || []).length, nmsg: (j.messages || []).length, sys: sys.slice(0, 300), last: lastUser.slice(0, 600), thinking: j.thinking }) + '\n'); } catch {}
    if (!req.url.includes('/messages')) { res.writeHead(404); res.end('{}'); return; }
    if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":1000}'); return; }

    const begin = (usage) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      sse(res, 'message_start', { type: 'message_start', message: { id: 'msg_mock' + Date.now() + Math.random().toString(36).slice(2, 6), type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, usage: { input_tokens: 4, output_tokens: 1, cache_creation_input_tokens: 20135, cache_read_input_tokens: 0, ...(usage || {}) } } });
    };
    const finish = (stop, out = 120) => { sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: out } }); sse(res, 'message_stop', { type: 'message_stop' }); res.end(); };
    const textBlock = (idx, text) => {
      sse(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } });
      sse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } });
      sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
    };

    if (isTitle) {
      stats.title++;
      await gate('title');
      begin(); textBlock(0, title); finish('end_turn', 10); return;
    }
    if (isCompact) {
      stats.compact++;
      const k = stats.compact - 1;
      bus.emit('compact-request', k);
      await gate(`compact${k}`);
      begin(); textBlock(0, (compactSummary && compactSummary(k)) || 'Summary: the user asked whether the Internationale can be realised. Research in progress; plans 1–N drafted, none conclusive. Continue from the latest plan.');
      await gate(`compact${k}:end`);
      finish('end_turn', 400); return;
    }
    const k = mainIdx++;
    stats.main = mainIdx;
    const T = script[k] || { id: `x${k}`, blocks: [{ type: 'text', text: '…' }] };
    bus.emit('main-request', k, T.id);
    if (T.startGate !== false) await gate(`${T.id}:start`);
    if (T.error && T.think) {   // it starts thinking, then the account is cut off mid-stream (SSE error event)
      begin(T.usage);
      sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
      const ch = chunksOf(T.think, T.thinkChunk || 4);
      for (let i = 0; i < ch.length; i++) {
        await gate(`${T.id}:th:${i}`);
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ch[i] } });
      }
      if (T.answer) {   // then it finally starts answering (a text block), and is cut off mid-word
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'film' } });
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
        sse(res, 'content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
        const tx = chunksOf(T.answer, T.answerChunk || 3);
        for (let i = 0; i < tx.length; i++) {
          await gate(`${T.id}:tx:${i}`);
          sse(res, 'content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: tx[i] } });
        }
      }
      await gate(`${T.id}:err`);
      sse(res, 'error', { type: 'error', error: { type: T.error.type, message: T.error.message } });
      res.end();
      bus.emit('main-done', k, T.id);
      return;
    }
    if (T.error) {
      const b = JSON.stringify({ type: 'error', error: { type: T.error.type, message: T.error.message } });
      res.writeHead(T.error.status, { 'content-type': 'application/json', 'request-id': 'req_film' + k, 'x-should-retry': 'false' });
      res.end(b);
      bus.emit('main-done', k, T.id);
      return;
    }
    begin(T.usage);
    let idx = 0;
    for (let bi = 0; bi < T.blocks.length; bi++) {
      const B = T.blocks[bi];
      if (B.gate) await gate(`${T.id}:${B.gate}`);
      if (B.type === 'thinking') {
        sse(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '', signature: '' } });
        const ch = chunksOf(B.text, B.chunk || 6);
        for (let i = 0; i < ch.length; i++) {
          if (B.gated) await gate(`${T.id}:b${bi}:${i}`);
          sse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: ch[i] } });
        }
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'signature_delta', signature: 'film' } });
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
      } else if (B.type === 'text' && B.gated) {   // streamed answer: one delta per chunk, each behind a gate
        sse(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } });
        const ch = chunksOf(B.text, B.chunk || 6);
        for (let i = 0; i < ch.length; i++) {
          await gate(`${T.id}:b${bi}:${i}`);
          sse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: ch[i] } });
        }
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
      } else if (B.type === 'text') {
        textBlock(idx, B.text);
      } else if (B.type === 'tool') {
        const id = `toolu_film${String(++toolSeq).padStart(5, '0')}`;
        sse(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id, name: B.name, input: {} } });
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(B.input) } });
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
      }
      idx++;
    }
    if (T.endGate) await gate(`${T.id}:end`);
    finish(T.stop || (T.blocks.some(b => b.type === 'tool') ? 'tool_use' : 'end_turn'), T.outTokens || 150);
    bus.emit('main-done', k, T.id);
  });
  srv.listen(port, '127.0.0.1');
  return srv;
}
