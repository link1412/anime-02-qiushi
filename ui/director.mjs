// Drives the real OpenCode web UI (against a scripted mock model) and captures
// one screenshot per film frame (30 fps) with deterministic time.
import { chromium } from 'playwright';
import fs from 'fs';
import crypto from 'crypto';
import { startMock, bus, release, reasoningChunkCount } from './mock.mjs';
import { buildTyping, compView, Q1, Q2 } from './typing.mjs';

const FPS = 30;
const OUT = process.env.OUT || '/path/to/ep1/build/ui_frames';
const MAXF = +(process.env.MAXF || 1e9);
const STARTF = +(process.env.STARTF || 0); // frames before this are simulated but not saved
fs.mkdirSync(OUT, { recursive: true });

// ---------- timeline ----------
const T_TYPE1 = 3.4;
const ty1 = buildTyping(T_TYPE1, Q1, 1030);
const T_ENTER1 = ty1.end + 0.55;
// real first-exchange offsets (ms after user message): reasoning 4716..7205, text 7206, done 7213
const R1 = { start: T_ENTER1 + 4.716, thEnd: T_ENTER1 + 7.205, text: T_ENTER1 + 7.206, end: T_ENTER1 + 7.213 };
const T_TYPE2 = T_ENTER1 + 27.0;
const ty2 = buildTyping(T_TYPE2, Q2, 2029);
const T_ENTER2 = ty2.end + 0.6;
const R2 = { start: T_ENTER2 + 3.8, thEnd: T_ENTER2 + 6.05, text: T_ENTER2 + 6.06, end: T_ENTER2 + 6.7 };
const T_END = T_ENTER2 + 24.0;
const NF = Math.ceil(T_END * FPS);

const events = [];
for (const e of ty1.events) events.push({ ...e, q: 1 });
events.push({ t: T_ENTER1, kind: 'enter', key: 'enter' });
events.push({ t: T_ENTER1 + 1.9, kind: 'gate', name: 'title' });
for (const e of ty2.events) events.push({ ...e, q: 2 });
events.push({ t: T_ENTER2, kind: 'enter', key: 'enter' });
function gateEvents(k, R) {
  const n = reasoningChunkCount(k);
  events.push({ t: R.start, kind: 'gate', name: `r${k}:start` });
  for (let i = 0; i < n; i++) events.push({ t: R.start + (R.thEnd - R.start) * (i + 1) / (n + 1), kind: 'gate', name: `r${k}:th${i}` });
  events.push({ t: R.text, kind: 'gate', name: `r${k}:text` });
  events.push({ t: R.end, kind: 'gate', name: `r${k}:end` });
}
gateEvents(0, R1); gateEvents(1, R2);
events.sort((a, b) => a.t - b.t);

const timeline = { FPS, NF, T_END, T_TYPE1, T_ENTER1, R1, T_TYPE2, T_ENTER2, R2, keys: events.filter(e => e.key).map(e => ({ t: e.t, key: e.key })) };
fs.writeFileSync(OUT + '/../timeline.json', JSON.stringify(timeline, null, 1));
console.log('frames', NF, 'T_END', T_END.toFixed(2), 'enter1', T_ENTER1.toFixed(2), 'enter2', T_ENTER2.toFixed(2));
if (process.env.PLAN_ONLY) process.exit(0);

// ---------- browser ----------
startMock();
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 1473, height: 926 }, deviceScaleFactor: 1.5, colorScheme: 'dark',
  httpCredentials: { username: 'opencode', password: 'film' }, locale: 'zh-CN',
});
await ctx.addInitScript(() => {
  const s = {"general":{"autoSave":true,"releaseNotes":false,"followup":"steer","showFileTree":false,"showNavigation":false,"showSearch":false,"showStatus":false,"showTerminal":false,"showReasoningSummaries":true,"shellToolPartsExpanded":false,"editToolPartsExpanded":false,"showCustomAgents":true,"mobileTitlebarPosition":"top","layoutTransitionEligible":false,"agentVisibilityInitialized":true,"newLayoutDesigns":true,"shouldDisplayTabsToast":false},"appearance":{"fontSize":14,"mono":"","sans":"","terminal":""},"keybinds":{},"permissions":{"autoApprove":false},"notifications":{"agent":false,"permissions":false,"errors":false},"sounds":{"agentEnabled":false,"agent":"staplebops-01","permissionsEnabled":false,"permissions":"staplebops-02","errorsEnabled":false,"errors":"nope-03"}};
  localStorage.setItem('settings.v3', JSON.stringify(s));
  localStorage.setItem('opencode-theme-id', 'dracula');
});
const page = await ctx.newPage();
await page.clock.install();
await page.goto('http://127.0.0.1:4399/L1VzZXJzL3dhbmd5YW4vRGVza3RvcC9jbGF1ZGUtcC9lcDE/session', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(7000);
if (await page.getByText('新建项目').count()) {
  await page.getByText('新建项目').click(); await page.waitForTimeout(700);
  await page.keyboard.type('~/Desktop/claude-p/ep1'); await page.waitForTimeout(1500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
}
await page.getByRole('button', { name: '选择模型变体' }).click(); await page.waitForTimeout(600);
await page.getByText(/^high$/i).last().click(); await page.waitForTimeout(600);
const editor = page.locator('[contenteditable="true"]').first();
await editor.click(); await page.waitForTimeout(300);
await page.mouse.move(-10, -10);

const INSTALL = async () => page.evaluate(() => {
  if (document.getElementById('film-style')) return;
  const st = document.createElement('style'); st.id = 'film-style';
  st.textContent = `
    [contenteditable="true"]{caret-color:transparent !important}
    *{cursor:none !important}
    #film-ov{position:fixed;inset:0;pointer-events:none;z-index:2147483647}
    #film-ov .tl{position:absolute;top:8.3px;width:8.3px;height:8.3px;border-radius:50%;box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.18)}
    #film-caret{position:absolute;width:1.4px;background:#f2f2f2;display:none}
    #film-ul{position:absolute;height:1px;background:rgba(235,235,235,.85);display:none}
    #film-cand{position:absolute;display:none;font:400 11.3px -apple-system,"PingFang SC",sans-serif;color:#e8e8e8;
      background:rgba(44,44,46,.97);border-radius:7px;padding:3.3px 3.3px;box-shadow:0 6px 18px rgba(0,0,0,.45),0 0 0 .7px rgba(255,255,255,.13);white-space:nowrap}
    #film-cand span.c{display:inline-block;padding:1.6px 6px;border-radius:4.5px;margin-right:1px}
    #film-cand span.c b{font-weight:400;color:rgba(235,235,245,.55);margin-right:4px;font-size:10px}
    #film-cand span.c.sel{background:#0a64d6;color:#fff}
    #film-cand span.c.sel b{color:rgba(255,255,255,.8)}
    #film-cand span.more{display:inline-block;padding:0 4px 0 3px;color:rgba(235,235,245,.6);font-size:9px}
  `;
  document.head.appendChild(st);
  const ov = document.createElement('div'); ov.id = 'film-ov';
  ov.innerHTML = `<div class="tl" style="left:10.5px;background:#ff5f57"></div><div class="tl" style="left:23.1px;background:#febc2e"></div><div class="tl" style="left:35.8px;background:#28c840"></div>
    <div id="film-caret"></div><div id="film-ul"></div><div id="film-cand"></div>
    <svg id="film-icons" style="position:absolute;top:0;left:0;width:100%;height:36px;overflow:visible"></svg>`;
  document.body.appendChild(ov);
});
// per-frame: patch titlebar (DEV badge -> spacer, extra right icons), overlays, animations
const FRAME_PATCH = async (state) => page.evaluate((s) => {
  const dev = [...document.querySelectorAll('header [class*="font-mono"]')].find(e => e.textContent.trim() === 'DEV');
  if (dev) { dev.textContent = ''; dev.style.cssText = 'background:transparent;width:66px;padding:0;height:20px;flex:none'; }
  const ed = document.querySelector('[contenteditable="true"]');
  if (ed) ed.setAttribute('spellcheck', 'false');
  // right icons (desktop build shows update + review buttons)
  const icons = document.getElementById('film-icons');
  if (icons && !icons.dataset.done) {
    icons.dataset.done = '1';
    const W = window.innerWidth;
    const x1 = W - 122.5, x2 = W - 79.5;
    icons.innerHTML = `<circle cx="${x1}" cy="18" r="7.2" fill="#3b3d4f"/><path d="M${x1} 14.2v6.4M${x1 - 2.6} 18.2l2.6 2.6 2.6-2.6" stroke="#d6d8e4" stroke-width="1.15" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="${x2 - 6.5}" y="12.2" width="13" height="11.5" rx="2" fill="none" stroke="#9ea2b8" stroke-width="1.1"/><path d="M${x2 - 6.5} 16.2h13" stroke="#9ea2b8" stroke-width="1.1"/><circle cx="${x2 + 6.2}" cy="11.6" r="2.4" fill="#39d353" stroke="#1b1c26" stroke-width="1"/>`;
  }
  // caret
  const caret = document.getElementById('film-caret'), ul = document.getElementById('film-ul'), cand = document.getElementById('film-cand');
  let crect = null;
  const sel = getSelection();
  if (ed && document.activeElement === ed && sel.rangeCount) {
    const r = sel.getRangeAt(0).cloneRange(); let rr = r.getBoundingClientRect();
    if (!rr.height) { const er = ed.getBoundingClientRect(); const cs = getComputedStyle(ed); rr = { x: er.x + parseFloat(cs.paddingLeft), y: er.y + parseFloat(cs.paddingTop) + 2, height: 16 }; }
    crect = { x: rr.x, y: rr.y, h: rr.height || 16 };
  }
  if (crect && s.caretOn) { caret.style.display = 'block'; caret.style.left = (crect.x - 0.5) + 'px'; caret.style.top = (crect.y) + 'px'; caret.style.height = crect.h + 'px'; }
  else caret.style.display = 'none';
  // marked text underline + candidate window
  if (s.marked && ed && crect) {
    const n = s.markedLen; const r = document.createRange();
    // find last text node
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let last = null; while (walker.nextNode()) if (walker.currentNode.length) last = walker.currentNode;
    if (last && last.length >= n) {
      r.setStart(last, last.length - n); r.setEnd(last, last.length);
      const rects = r.getClientRects(); const a = rects[0], b = rects[rects.length - 1];
      ul.style.display = 'block'; ul.style.left = a.left + 'px'; ul.style.top = (a.bottom - 1) + 'px'; ul.style.width = (b.right - a.left) + 'px';
      cand.style.display = 'block'; cand.style.left = (a.left - 6) + 'px'; cand.style.top = (a.bottom + 5) + 'px';
      cand.innerHTML = s.cands.map((c, i) => `<span class="c${i === 0 ? ' sel' : ''}"><b>${i + 1}</b>${c}</span>`).join('') + '<span class="more">⌄</span>';
    }
  } else { ul.style.display = 'none'; cand.style.display = 'none'; }
  // animations: drive by film time
  window.__animStart = window.__animStart || new WeakMap();
  for (const a of document.getAnimations()) {
    if (!window.__animStart.has(a)) window.__animStart.set(a, s.ms);
    try { a.pause(); a.currentTime = s.ms - window.__animStart.get(a); } catch (e) {}
  }
}, state);


const SEL_LAST = async (n) => page.evaluate((n) => {
  const ed = document.querySelector('[contenteditable="true"]');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) if (w.currentNode.length) nodes.push(w.currentNode);
  if (!nodes.length) return false;
  let rem = n, i = nodes.length - 1, node = nodes[i];
  const end = node; const endOff = node.length;
  while (rem > node.length && i > 0) { rem -= node.length; node = nodes[--i]; }
  const r = document.createRange(); r.setStart(node, Math.max(0, node.length - rem)); r.setEnd(end, endOff);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true;
}, n);
const FOCUS = async () => page.evaluate(() => { const ed = document.querySelector('[contenteditable="true"]'); if (ed && document.activeElement !== ed) { ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } });
const REPLACE_LAST = async (n, str) => { await FOCUS(); if (n > 0) await SEL_LAST(n); if (str.length) await page.keyboard.insertText(str); else if (n > 0) await page.keyboard.press('Backspace'); };

// ---------- run ----------
await INSTALL();
await page.clock.pauseAt(Date.now() + 2000);
let ei = 0, comp = null, lastKeyT = -10;
const index = [];
const seen = new Map();
const tStart = Date.now();
for (let f = 0; f < Math.min(NF, MAXF); f++) {
  const t = f / FPS;
  let gated = false, nav = false;
  while (ei < events.length && events[ei].t <= t) {
    const e = events[ei++];
    if (e.kind === 'comp') {
      const prevLen = comp ? comp.typed.length : 0;
      await REPLACE_LAST(prevLen, e.typed);
      comp = e.typed.length ? { py: e.py, typed: e.typed, zh: e.zh } : null; lastKeyT = t;
    } else if (e.kind === 'commit') {
      await REPLACE_LAST(comp.typed.length, e.zh); comp = null; lastKeyT = t;
    } else if (e.kind === 'punct') { await page.keyboard.insertText(e.text); lastKeyT = t; }
    else if (e.kind === 'enter') { await page.keyboard.press('Enter'); lastKeyT = t; nav = true; }
    else if (e.kind === 'gate') { release(e.name); gated = true; }
  }
  if (nav) { await page.waitForTimeout(700); await page.clock.runFor(300); await page.waitForTimeout(300); await FOCUS(); }
  if (gated) await page.waitForTimeout(140);
  await page.clock.runFor(1000 / FPS);
  if (gated || nav) await page.waitForTimeout(40);
  let marked = null, cands = null, markedLen = 0;
  if (comp) { const v = compView(comp.py, comp.typed, comp.zh); marked = v.marked; cands = v.cands; markedLen = comp.typed.length; }
  const sinceKey = t - lastKeyT;
  const caretOn = !comp && (sinceKey < 0.5 || Math.floor((sinceKey - 0.5) / 0.53) % 2 === 1);
  // display marked text with syllable spaces: swap raw letters for spaced version
  if (comp && marked !== comp.typed) {
    await REPLACE_LAST(comp.typed.length, marked); markedLen = marked.length; comp.__displayLen = marked.length;
  }
  await FRAME_PATCH({ ms: t * 1000, caretOn: caretOn || (!!comp), marked: !!comp, markedLen, cands });
  if (f >= STARTF) {
    const buf = await page.screenshot({ type: 'png' });
    const h = crypto.createHash('md5').update(buf).digest('hex').slice(0, 16);
    if (!seen.has(h)) { const name = `u_${String(seen.size).padStart(5, '0')}.png`; fs.writeFileSync(`${OUT}/${name}`, buf); seen.set(h, name); }
    index.push(seen.get(h));
  }
  // restore raw letters after display swap so the next keystroke edits correctly
  if (comp && comp.__displayLen) { await REPLACE_LAST(comp.__displayLen, comp.typed); comp.__displayLen = 0; }
  if (f % 60 === 0) { console.log(`f ${f}/${NF} t=${t.toFixed(2)} unique=${seen.size} el=${((Date.now() - tStart) / 1000).toFixed(0)}s`); fs.writeFileSync(OUT + '/../ui_index.json', JSON.stringify({ startFrame: STARTF, frames: index })); }
}
fs.writeFileSync(OUT + '/../ui_index.json', JSON.stringify({ startFrame: STARTF, frames: index }));
console.log('done unique', seen.size);
await browser.close();
process.exit(0);
