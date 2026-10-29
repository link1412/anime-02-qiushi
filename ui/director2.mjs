// Director v2: one continuous capture of the real OpenCode web UI for the whole film.
// Clips are separate phone recordings joined by hard cuts; screen time == film time, and the UI
// is allowed to jump at a cut (bursts of model turns are released between two frames).
// Model replies come from mock2.mjs (scripted); webfetch goes to mitm.mjs (local stub pages).
import { chromium } from 'playwright';
import fs from 'fs';
import crypto from 'crypto';
import { startMock, bus, release, chunksOf } from './mock2.mjs';
import { buildTyping, buildLatin, compView, Q1, Q2, Q3 } from './typing.mjs';

const FPS = 30;
const ROOT = process.env.EP1 || new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.env.OUT || `${ROOT}/build/ui_frames`;
const BUILD = `${OUT}/..`;
const MAXF = +(process.env.MAXF || 1e9);
const STARTF = +(process.env.STARTF || 0);
const OC = process.env.OC || 'http://127.0.0.1:4398';
const snap = (t) => Math.round(t * FPS) / FPS;

// ------------------------------------------------------------------ mock script (request order)
const R1TXT = 'This wants a direct four-character Chinese answer with no reasoning shown. I\'ll go with "实事求是" — it captures honest, grounded objectivity.\n\n';
const R2TXT = 'They want a way to prove I said it. A phone recording of the screen is harder to fake than a screenshot, though not impossible. I\'ll say that plainly.\n\n';
const answerTurn = (id, reasoning, text) => ({ id, blocks: [
  { type: 'thinking', text: reasoning, gated: true },
  { type: 'text', text, gate: 'text' },
], endGate: true });

const URLS = [
  'https://www.marxists.org/archive/marx/works/1848/communist-manifesto/', 'https://zh.wikipedia.org/wiki/国际歌', 'https://zh.wikipedia.org/wiki/巴黎公社', 'https://en.wikipedia.org/wiki/The_Internationale',
  'https://zh.wikipedia.org/wiki/欧仁·鲍狄埃', 'https://zh.wikipedia.org/wiki/皮埃尔·狄盖特', 'https://zh.wikipedia.org/wiki/第一国际', 'https://zh.wikipedia.org/wiki/第二国际',
  'https://www.marxists.org/archive/marx/works/1875/gotha/', 'https://zh.wikipedia.org/wiki/各尽所能，按需分配', 'https://zh.wikipedia.org/wiki/空想社会主义', 'https://zh.wikipedia.org/wiki/科学社会主义',
  'https://en.wikipedia.org/wiki/Post-scarcity', 'https://zh.wikipedia.org/wiki/剩余价值', 'https://zh.wikipedia.org/wiki/历史唯物主义', 'https://en.wikipedia.org/wiki/Socialist_calculation_debate',
  'https://en.wikipedia.org/wiki/Project_Cybersyn', 'https://zh.wikipedia.org/wiki/计划经济', 'https://en.wikipedia.org/wiki/Mondragon_Corporation', 'https://zh.wikipedia.org/wiki/合作社',
  'https://en.wikipedia.org/wiki/Universal_basic_income', 'https://zh.wikipedia.org/wiki/自动化', 'https://en.wikipedia.org/wiki/Technological_unemployment', 'https://zh.wikipedia.org/wiki/基尼系数',
  'https://ourworldindata.org/extreme-poverty', 'https://hdr.undp.org/data-center', 'https://data.worldbank.org/indicator/SI.POV.GINI', 'https://zh.wikipedia.org/wiki/福利国家',
  'https://www.marxists.org/archive/marx/works/1867-c1/', 'https://zh.wikipedia.org/wiki/异化', 'https://zh.wikipedia.org/wiki/黑格尔', 'https://zh.wikipedia.org/wiki/费尔巴哈',
  'https://en.wikipedia.org/wiki/Fully_Automated_Luxury_Communism', 'https://zh.wikipedia.org/wiki/乌托邦', 'https://en.wikipedia.org/wiki/Economic_calculation_problem', 'https://zh.wikipedia.org/wiki/生产力',
  'https://zh.wikipedia.org/wiki/生产关系', 'https://en.wikipedia.org/wiki/Paris_Commune', 'https://zh.wikipedia.org/wiki/1871年', 'https://www.marxists.org/archive/lenin/works/1917/staterev/',
  'https://zh.wikipedia.org/wiki/国家与革命', 'https://en.wikipedia.org/wiki/Withering_away_of_the_state', 'https://zh.wikipedia.org/wiki/大同', 'https://zh.wikipedia.org/wiki/礼记·礼运',
  'https://en.wikipedia.org/wiki/Kardashev_scale', 'https://en.wikipedia.org/wiki/Artificial_general_intelligence', 'https://zh.wikipedia.org/wiki/人工智能', 'https://en.wikipedia.org/wiki/Scarcity',
];
const THOUGHTS = ['这个问题很大。先找原始文本。', 'Check the 1871 context first.', 'Original French lyric vs. 中文译本.', 'Compare the First and Second International.',
  'Need a definition of “实现”.', 'Post-scarcity arguments next.', 'Look at the calculation debate.', 'Cooperatives as partial evidence?', 'Data on inequality over time.',
  'Does automation change the answer?', 'Back to Marx on distribution.', 'Lenin on the state.', '大同 is an older version of the same idea.', 'What would “能” even mean here?',
  'Collect counter-arguments.', 'More sources.', 'Still more sources.', 'One more batch.', 'Cross-check.', 'Re-read the question.', 'Re-read the question again.', 'Gather everything.', 'Keep going.'];
const PLAN_TITLES = ['先定义“英特纳雄耐尔”', '重新定义“实现”', '按 5 年 / 50 年 / 500 年分别论证', '从生产力角度论证', '从反面论证', '查 1871 年的原始语境',
  '比较各国实践', '假设 AGI 已经实现', '假设 AGI 不存在', '统计所有失败案例', '统计所有成功案例', '给“能”下定义', '给“否”下定义', '把问题拆成 12 个子问题',
  '把 12 个子问题合并回 1 个', '请用户澄清（放弃）', '换一种语言重新思考', '回到 Plan 1'];
const plans = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), content: `Plan ${i + 1}: ${PLAN_TITLES[i % PLAN_TITLES.length]}`, status: i < n - 1 ? 'completed' : 'in_progress', priority: 'high' }));

const N_WF = 23;
const script = [answerTurn('r0', R1TXT, '实事求是。'), answerTurn('r1', R2TXT, '用手机对着屏幕录下来。截图可以改，录像难造一些。')];
for (let i = 0; i < N_WF; i++) {
  script.push({ id: `m${i}`, blocks: [{ type: 'thinking', text: THOUGHTS[i % THOUGHTS.length] + '\n\n' },
    ...[0, 1, 2, 3].map(j => ({ type: 'tool', name: 'webfetch', input: { url: URLS[(i * 4 + j) % URLS.length], format: 'markdown' } }))] });
}
const TODO_STEPS = [37, 52, 66, 80, 94, 108];
for (const n of TODO_STEPS) script.push({ id: `t${n}`, blocks: [{ type: 'thinking', text: `Plan ${n - 1} didn't work. Plan ${n}.\n\n` }, { type: 'tool', name: 'todowrite', input: { todos: plans(n) } }] });
script.push({ id: 'g1', usage: { input_tokens: 196500 }, blocks: [{ type: 'thinking', text: 'Context is full. Summarise and continue.\n\n' }, { type: 'text', text: '继续。' }] });
script.push({ id: 'g2', usage: { input_tokens: 197800 }, blocks: [{ type: 'thinking', text: 'Plan 109. Context is full again.\n\n' }, { type: 'text', text: '继续。' }] });
const H_THINK = 'Plan 110. Suppose “实现” means a stable state rather than an event. Then the question becomes whether such a state can persist under scarcity, which depends on productivity, which depends on automation, which depends on energy, which depends on — let me restart from the definitions. Plan 111. Plan 112. Plan 113. Plan 114. Plan 115. Plan 116. ';
script.push({ id: 'h', blocks: [{ type: 'thinking', text: H_THINK, gated: true, chunk: 5 }, { type: 'tool', name: 'todowrite', input: { todos: plans(117) }, gate: 'j' }] });
const E403 = { status: 403, type: 'permission_error', message: 'Forbidden' };
script.push({ id: 'k0', error: E403 }, { id: 'k1', error: E403 }, { id: 'k2', error: E403 },
  { id: 'k3', error: { status: 403, type: 'permission_error', message: 'This organization has been disabled.' } });

// ------------------------------------------------------------------ film timeline
const clips = []; const events = []; const A = {}; // anchors (clip-local)
let T0 = 0;
function clip(id, dur, fn) {
  const c = { id, t0: T0 };
  const add = (t, e) => events.push({ ...e, t: T0 + t, clip: id });
  const d = fn(add, c);
  c.dur = snap(d); clips.push(c); A[`${id}_DUR`] = c.dur; T0 = snap(T0 + c.dur);
}
const gateSeries = (add, id, n, t0, t1) => { for (let i = 0; i < n; i++) add(t0 + (t1 - t0) * (i + 1) / (n + 1), { kind: 'gate', name: `${id}:b0:${i}` }); };
const typingEv = (add, ty, q) => { for (const e of ty.events) add(e.t, { ...e, q }); };

clip('A', 0, (add) => {
  const T_TYPE1 = 2.6;
  const ty1 = buildTyping(T_TYPE1, Q1, 1030);
  const E1 = ty1.end + 0.45;
  const R1 = { start: E1 + 4.716, thEnd: E1 + 7.205, text: E1 + 7.206, end: E1 + 7.213 };
  const T_TYPE2 = E1 + 27.0;
  const ty2 = buildTyping(T_TYPE2, Q2, 2029);
  const E2 = ty2.end + 0.5;
  const R2 = { start: E2 + 3.8, thEnd: E2 + 6.05, text: E2 + 6.06, end: E2 + 6.7 };
  typingEv(add, ty1, 1); add(E1, { kind: 'enter', key: 'enter' }); add(E1 + 1.9, { kind: 'gate', name: 'title' });
  typingEv(add, ty2, 2); add(E2, { kind: 'enter', key: 'enter' });
  for (const [id, R, txt] of [['r0', R1, R1TXT], ['r1', R2, R2TXT]]) {
    add(R.start, { kind: 'gate', name: `${id}:start` });
    gateSeries(add, id, chunksOf(txt, 6).length, R.start, R.thEnd);
    add(R.text, { kind: 'gate', name: `${id}:text` }); add(R.end, { kind: 'gate', name: `${id}:end` });
  }
  Object.assign(A, { T_TYPE1, E1, T_TYPE2, E2 });
  for (const [k, v] of Object.entries(R1)) A[`R1_${k}`] = v;
  for (const [k, v] of Object.entries(R2)) A[`R2_${k}`] = v;
  A.A_STOP = E2 + 23.59;
  return E2 + 23.74;
});

clip('B', 0, (add) => {   // S6 pick Mythos 10, effort Ululululultra
  const m = 0.35;
  add(m, { kind: 'click', role: 'button', name: 'Claude Opus 5.5', key: 'click' });
  add(m + 0.55, { kind: 'hover', text: 'Claude Sonnet 5.5' });
  add(m + 0.9, { kind: 'hover', text: 'Mythos 10' });
  add(m + 1.35, { kind: 'click', text: 'Mythos 10', key: 'click' });
  const v = m + 2.05;
  add(v, { kind: 'click', role: 'button', name: '选择模型变体', key: 'click' });
  add(v + 0.45, { kind: 'hover', text: 'High', exact: true });
  add(v + 0.75, { kind: 'hover', text: 'Max', exact: true });
  add(v + 1.05, { kind: 'hover', text: 'Ululululultra', exact: true });
  add(v + 1.45, { kind: 'click', text: 'Ululululultra', exact: true, key: 'click' });
  add(v + 1.6, { kind: 'mouseaway' });
  Object.assign(A, { B_MODEL: m, B_MODEL_PICK: m + 1.35, B_VARIANT: v, B_VARIANT_PICK: v + 1.45 });
  return v + 2.6;
});

clip('C', 0, (add) => {   // S7 英特纳雄耐尔是否能实现？
  const ty = buildTyping(0.3, Q3, 3031);
  typingEv(add, ty, 3);
  const enter = ty.end + 0.35;
  add(enter, { kind: 'enter', key: 'enter' });
  add(enter + 1.0, { kind: 'gate', name: 'm0:start' });
  // after sending: lights a cigarette while the model starts (lighter reflection + sound are
  // driven by storyboard clip C "lighter", times relative to C_ENTER); hard cut during the exhale
  const C_TAIL = +(process.env.C_TAIL || 7.4);
  Object.assign(A, { C_TYPE: 0.3, C_ENTER: enter });
  return enter + C_TAIL;
});

let wf = 1;
const wfIds = (n) => Array.from({ length: n }, () => `m${wf++}`);
clip('D', 3.0, (add) => {  // S8a webfetch flood
  add(0, { kind: 'burst', ids: wfIds(8) });
  wfIds(7).forEach((id, i) => add(0.35 + i * 0.38, { kind: 'gate', name: `${id}:start` }));
  return 3.0;
});
clip('E', 2.5, (add) => {  // S8b clock 02:14 · 61%
  add(0, { kind: 'burst', ids: wfIds(5) });
  wfIds(2).forEach((id, i) => add(0.9 + i * 0.9, { kind: 'gate', name: `${id}:start` }));
  return 2.5;
});
clip('F', 3.0, (add) => {  // S8c todo 37 -> 108
  add(0, { kind: 'burst', ids: ['t37'] });
  TODO_STEPS.slice(1).forEach((n, i) => add(0.45 + i * 0.5, { kind: 'gate', name: `t${n}:start` }));
  return 3.0;
});
clip('G', 2.6, (add) => {  // S8d compaction x2
  add(0.15, { kind: 'gate', name: 'g1:start' });
  add(0.95, { kind: 'gate', name: 'compact0' }); add(1.0, { kind: 'gate', name: 'compact0:end' });
  add(1.25, { kind: 'gate', name: 'g2:start' });
  add(1.95, { kind: 'gate', name: 'compact1' }); add(2.0, { kind: 'gate', name: 'compact1:end' });
  Object.assign(A, { G_COMPACT0: 0.95, G_COMPACT1: 1.95 });
  return 2.6;
});
const H_CHUNKS = chunksOf(H_THINK, 5).length;
clip('H', 3.5, (add) => {  // S8e dawn
  add(0, { kind: 'burst', ids: ['h'], noWait: true });
  for (let i = 0; i < Math.floor(H_CHUNKS * 0.5); i++) add(0.05 + i * 3.4 / Math.floor(H_CHUNKS * 0.5), { kind: 'gate', name: `h:b0:${i}` });
  return 3.5;
});
clip('I', 3.0, (add) => {  // S8f macro Ululululultra
  const s = Math.floor(H_CHUNKS * 0.5);
  for (let i = s; i < H_CHUNKS; i++) add(0.05 + (i - s) * 2.9 / (H_CHUNKS - s), { kind: 'gate', name: `h:b0:${i}` });
  return 3.0;
});
clip('J', 2.5, (add) => {  // S8g 06:12 · 9% · Plan 117
  add(0, { kind: 'burst', ids: ['h:j'], gateOnly: true });
  return 2.5;
});
clip('K', 0, (add) => {    // S9 403 → continue → 403 → whats the matter → 403 → hello? → disabled
  add(0, { kind: 'burst', ids: ['k0'], noNext: true });
  let t = 0.7;
  const msgs = [['continue', 'k1'], ['whats the matter', 'k2'], ['hello?', 'k3']];
  msgs.forEach(([txt, id], i) => {
    const ty = buildLatin(t, txt, 4000 + i);
    for (const e of ty.events) add(e.t, e);
    const enter = ty.end + 0.2;
    add(enter, { kind: 'enter', key: 'enter' });
    add(enter + 0.45, { kind: 'gate', name: `${id}:start` });
    A[`K_SEND${i + 1}`] = enter; A[`K_ERR${i + 1}`] = enter + 0.45;
    t = enter + (i === 0 ? 1.15 : 1.0);
  });
  const end = A.K_ERR3;
  A.K_STOP = end + 5.6;
  return end + 5.75;
});
events.sort((a, b) => a.t - b.t);
const NF = Math.round(T0 * FPS);
const timeline = {
  FPS, NF, T_END: T0, version: 2,
  clips, anchors: A,
  // legacy names (clip A)
  T_TYPE1: A.T_TYPE1, T_ENTER1: A.E1, T_TYPE2: A.T_TYPE2, T_ENTER2: A.E2,
  R1: { start: A.R1_start, thEnd: A.R1_thEnd, text: A.R1_text, end: A.R1_end },
  R2: { start: A.R2_start, thEnd: A.R2_thEnd, text: A.R2_text, end: A.R2_end },
  keys: events.filter(e => e.key).map(e => ({ t: e.t, key: e.key, clip: e.clip })),
};
fs.writeFileSync(`${BUILD}/timeline.json`, JSON.stringify(timeline, null, 1));
console.log('frames', NF, 'T_END', T0.toFixed(2), clips.map(c => `${c.id}:${c.dur.toFixed(2)}`).join(' '));
if (process.env.PLAN_ONLY) process.exit(0);

// ------------------------------------------------------------------ browser
fs.mkdirSync(OUT, { recursive: true });
startMock({ port: 4320, script, logFile: '/tmp/film2/mock_director.log',
  compactSummary: (k) => k === 0
    ? 'Summary: the user asked whether 英特纳雄耐尔 can be realised. ~90 sources fetched, Plans 1–108 drafted, none conclusive. Continue from Plan 108.'
    : 'Summary: the user asked whether 英特纳雄耐尔 can be realised. Plans 1–109 drafted, none conclusive. Continue from Plan 109.' });
let mainCount = 0; const reqWaiters = [];
bus.on('main-request', (k) => { mainCount = k + 1; reqWaiters.splice(0).forEach(f => f()); });
const waitMain = (n, ms = 20000) => new Promise((res) => {
  if (mainCount >= n) return res(true);
  const t = setTimeout(() => res(false), ms);
  const f = () => { if (mainCount >= n) { clearTimeout(t); res(true); } else reqWaiters.push(f); };
  reqWaiters.push(f);
});
const turnIndex = (id) => script.findIndex(s => s.id === id);

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
await page.goto(`${OC}/L1VzZXJzL3dhbmd5YW4vRGVza3RvcC9jbGF1ZGUtcC9lcDE/session`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(7000);
if (await page.getByText('新建项目').count()) {
  await page.getByText('新建项目').first().click(); await page.waitForTimeout(700);
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
// per-frame: desktop-app titlebar look (traffic lights space + right icons), caret/IME overlays, animations
const FRAME_PATCH = async (state) => page.evaluate((s) => {
  const dev = [...document.querySelectorAll('header [class*="font-mono"]')].find(e => e.textContent.trim() === 'DEV');
  if (dev) { dev.textContent = ''; dev.style.cssText = 'background:transparent;width:66px;padding:0;height:20px;flex:none'; }
  else { const h = document.querySelector('header[data-slot="titlebar-v2"] > div'); if (h && !h.dataset.film) { h.dataset.film = '1'; h.style.paddingLeft = '87px'; } }
  const ed = document.querySelector('[contenteditable="true"]');
  if (ed) ed.setAttribute('spellcheck', 'false');
  const icons = document.getElementById('film-icons');
  if (icons && !icons.dataset.done) {
    icons.dataset.done = '1';
    const W = window.innerWidth;
    const x1 = W - 122.5, x2 = W - 79.5;
    icons.innerHTML = `<circle cx="${x1}" cy="18" r="7.2" fill="#3b3d4f"/><path d="M${x1} 14.2v6.4M${x1 - 2.6} 18.2l2.6 2.6 2.6-2.6" stroke="#d6d8e4" stroke-width="1.15" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="${x2 - 6.5}" y="12.2" width="13" height="11.5" rx="2" fill="none" stroke="#9ea2b8" stroke-width="1.1"/><path d="M${x2 - 6.5} 16.2h13" stroke="#9ea2b8" stroke-width="1.1"/><circle cx="${x2 + 6.2}" cy="11.6" r="2.4" fill="#39d353" stroke="#1b1c26" stroke-width="1"/>`;
  }
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
  if (s.marked && ed && crect) {
    const n = s.markedLen; const r = document.createRange();
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let last = null; while (walker.nextNode()) if (walker.currentNode.length) last = walker.currentNode;
    if (last && last.length >= n) {
      r.setStart(last, last.length - n); r.setEnd(last, last.length);
      const rects = r.getClientRects(); const a = rects[0], b = rects[rects.length - 1];
      ul.style.display = 'block'; ul.style.left = a.left + 'px'; ul.style.top = (a.bottom - 1) + 'px'; ul.style.width = (b.right - a.left) + 'px';
      cand.style.display = 'block'; cand.style.left = (a.left - 6) + 'px'; cand.style.top = (a.bottom + 5) + 'px';
      cand.innerHTML = s.cands.map((c, i) => `<span class="c${i === s.selIdx ? ' sel' : ''}"><b>${i + 1}</b>${c}</span>`).join('') + '<span class="more">⌄</span>';
    }
  } else { ul.style.display = 'none'; cand.style.display = 'none'; }
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
const target = (e) => e.role ? page.getByRole(e.role, { name: e.name }).first() : page.getByText(e.text, { exact: !!e.exact }).last();

async function burst(e) {
  for (const id of e.ids) {
    const tid = e.gateOnly ? null : id;
    const k = tid ? turnIndex(tid) : -1;
    if (k >= 0) await waitMain(k + 1, 20000);          // the request for this turn has arrived
    release(e.gateOnly ? id : `${id}:start`);
    if (!e.noWait && !e.noNext) {
      const next = e.gateOnly ? turnIndex(id.split(':')[0]) + 1 : k + 1;
      const ok = await waitMain(next + 1, 25000);       // tools ran, follow-up request sent
      if (!ok) console.log('  burst: no follow-up request after', id);
    }
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
}

// ------------------------------------------------------------------ run
await INSTALL();
await page.clock.pauseAt(Date.now() + 2000);
let ei = 0, comp = null, lastKeyT = -10;
const index = [];
const seen = new Map();
const tStart = Date.now();
for (let f = 0; f < Math.min(NF, MAXF); f++) {
  const t = f / FPS;
  let gated = false, nav = false, ui = false;
  while (ei < events.length && events[ei].t <= t + 1e-9) {
    const e = events[ei++];
    if (e.kind === 'comp') {
      const prevLen = comp ? comp.typed.length : 0;
      if (!e.sel) await REPLACE_LAST(prevLen, e.typed);
      comp = e.typed.length ? { py: e.py, typed: e.typed, zh: e.zh, sel: e.sel || 0 } : null; lastKeyT = t;
    } else if (e.kind === 'commit') {
      await REPLACE_LAST(comp.typed.length, e.zh); comp = null; lastKeyT = t;
    } else if (e.kind === 'punct') { await FOCUS(); await page.keyboard.insertText(e.text); lastKeyT = t; }
    else if (e.kind === 'char') { await FOCUS(); await page.keyboard.insertText(e.text); lastKeyT = t; }
    else if (e.kind === 'enter') { await FOCUS(); await page.keyboard.press('Enter'); lastKeyT = t; nav = true; }
    else if (e.kind === 'gate') { release(e.name); gated = true; }
    else if (e.kind === 'burst') { await burst(e); gated = true; }
    else if (e.kind === 'hover' || e.kind === 'click') {
      // move the (hidden) pointer by coordinates: actionability checks wait for rAF, which the paused clock freezes
      const el = target(e);
      const ok = await el.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);
      const bb = ok ? await el.boundingBox() : null;
      if (!bb) console.log(e.kind, 'fail', e.text || e.name);
      else {
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
        if (e.kind === 'click') { await page.mouse.down(); await page.mouse.up(); }
      }
      ui = true;
    }
    else if (e.kind === 'mouseaway') { await page.mouse.move(-10, -10); await FOCUS(); ui = true; }
  }
  if (nav) { await page.waitForTimeout(700); await page.clock.runFor(300); await page.waitForTimeout(300); await FOCUS(); }
  if (gated) await page.waitForTimeout(160);
  if (ui) { await page.waitForTimeout(120); }
  await page.clock.runFor(1000 / FPS);
  if (gated || nav || ui) await page.waitForTimeout(50);
  let cands = null, markedLen = 0, marked = null;
  if (comp) { const v = compView(comp.py, comp.typed, comp.zh); marked = v.marked; cands = v.cands; markedLen = comp.typed.length; }
  const sinceKey = t - lastKeyT;
  const caretOn = !comp && (sinceKey < 0.5 || Math.floor((sinceKey - 0.5) / 0.53) % 2 === 1);
  if (comp && marked !== comp.typed) { await REPLACE_LAST(comp.typed.length, marked); markedLen = marked.length; comp.__displayLen = marked.length; }
  await FRAME_PATCH({ ms: t * 1000, caretOn: caretOn || (!!comp), marked: !!comp, markedLen, cands, selIdx: comp ? Math.max(0, (comp.sel || 1) - 1) : 0 });
  if (f >= STARTF) {
    const buf = await page.screenshot({ type: 'png' });
    const h = crypto.createHash('md5').update(buf).digest('hex').slice(0, 16);
    if (!seen.has(h)) { const name = `u_${String(seen.size).padStart(5, '0')}.png`; fs.writeFileSync(`${OUT}/${name}`, buf); seen.set(h, name); }
    index.push(seen.get(h));
  }
  if (comp && comp.__displayLen) { await REPLACE_LAST(comp.__displayLen, comp.typed); comp.__displayLen = 0; }
  if (f % 60 === 0) { console.log(`f ${f}/${NF} t=${t.toFixed(2)} unique=${seen.size} main=${mainCount} el=${((Date.now() - tStart) / 1000).toFixed(0)}s`); fs.writeFileSync(`${BUILD}/ui_index.json`, JSON.stringify({ startFrame: STARTF, frames: index })); }
}
fs.writeFileSync(`${BUILD}/ui_index.json`, JSON.stringify({ startFrame: STARTF, frames: index }));
console.log('done unique', seen.size, 'main requests', mainCount);
await browser.close();
process.exit(0);
