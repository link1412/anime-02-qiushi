// Director v2: one continuous capture of the real OpenCode web UI for the whole film.
// Clips are separate phone recordings joined by hard cuts; screen time == film time, and the UI
// is allowed to jump at a cut (bursts of model turns are released between two frames).
// Model replies come from mock2.mjs (scripted); webfetch goes to mitm.mjs (local stub pages).
import { chromium } from 'playwright';
import fs from 'fs';
import crypto from 'crypto';
import { startMock, bus, release, chunksOf } from './mock2.mjs';
import { buildTyping, buildLatin, compView, Q0, Q1, Q2, Q3, Q4, Q5 } from './typing.mjs';

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

// The second question is "明天早上吃什么?" (00:31). Mythos could answer at once; instead it decides the variable is
// the user, models them, and simulates their morning 16 times. Black humour: over-competent, never stupid.
const URLS = [
  'https://zh.wikipedia.org/wiki/明天', 'https://en.wikipedia.org/wiki/Midnight', 'https://en.wikipedia.org/wiki/Morning', 'https://en.wikipedia.org/wiki/Sunrise_equation',
  'https://www.timeanddate.com/sun/', 'https://en.wikipedia.org/wiki/List_of_cities_by_population', 'https://en.wikipedia.org/wiki/Keystroke_dynamics', 'https://zh.wikipedia.org/wiki/中华人民共和国城市列表',
  'https://zh.wikipedia.org/wiki/早餐', 'https://zh.wikipedia.org/wiki/豆浆', 'https://zh.wikipedia.org/wiki/油条', 'https://zh.wikipedia.org/wiki/粥',
  'https://zh.wikipedia.org/wiki/包子', 'https://zh.wikipedia.org/wiki/煎饼果子', 'https://zh.wikipedia.org/wiki/馄饨', 'https://zh.wikipedia.org/wiki/豆腐脑',
  'https://zh.wikipedia.org/wiki/肠粉', 'https://zh.wikipedia.org/wiki/热干面', 'https://en.wikipedia.org/wiki/Breakfast', 'https://en.wikipedia.org/wiki/Circadian_rhythm',
  'https://en.wikipedia.org/wiki/Ghrelin', 'https://en.wikipedia.org/wiki/Leptin', 'https://en.wikipedia.org/wiki/Hunger_(physiology)', 'https://en.wikipedia.org/wiki/Sleep_deprivation',
  'https://en.wikipedia.org/wiki/Wakefulness', 'https://en.wikipedia.org/wiki/Sleep_inertia', 'https://en.wikipedia.org/wiki/Alarm_clock', 'https://en.wikipedia.org/wiki/Decision_theory',
  'https://en.wikipedia.org/wiki/Loss_aversion', 'https://en.wikipedia.org/wiki/Monte_Carlo_method', 'https://en.wikipedia.org/wiki/Expected_utility_hypothesis', 'https://en.wikipedia.org/wiki/Minimax',
  'https://en.wikipedia.org/wiki/Risk_aversion', 'https://en.wikipedia.org/wiki/Food_safety', 'https://zh.wikipedia.org/wiki/食物中毒', 'https://en.wikipedia.org/wiki/Glycemic_index',
  'https://zh.wikipedia.org/wiki/反式脂肪', 'https://en.wikipedia.org/wiki/Satiety', 'https://en.wikipedia.org/wiki/Appetite', 'https://en.wikipedia.org/wiki/User_modeling',
  'https://zh.wikipedia.org/wiki/日出', 'https://en.wikipedia.org/wiki/Dawn', 'https://en.wikipedia.org/wiki/Twilight', 'https://en.wikipedia.org/wiki/Time_zone',
  'https://zh.wikipedia.org/wiki/北京时间', 'https://en.wikipedia.org/wiki/Behavioral_modeling', 'https://en.wikipedia.org/wiki/Preference', 'https://en.wikipedia.org/wiki/Choking',
];
// one-off fetches at fixed turns (the deleted "模拟" question; the cigarette; the 16 to come)
// + paper searches tied to the beat shown in that turn's reasoning (real papers / real search endpoints only;
//   every fetch is answered by the local stub, nothing leaves the machine)
const SPECIAL_URLS = {
  5: ['https://arxiv.org/search/?query=simulating+a+specific+human&searchtype=all', 'https://arxiv.org/abs/2304.03442', 'https://arxiv.org/abs/2209.06899'],
  14: ['https://arxiv.org/search/?query=monte+carlo+simulation+human+morning&searchtype=all', 'https://arxiv.org/abs/1712.01815', 'https://arxiv.org/abs/1707.02038'],
  18: ['https://pubmed.ncbi.nlm.nih.gov/?term=sleep+deprivation+ghrelin', 'https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0010062'],
  20: ['https://en.wikipedia.org/wiki/Simulation_hypothesis', 'https://www.simulation-argument.com/simulation.pdf'],
  24: ['https://arxiv.org/abs/1611.08219', 'https://arxiv.org/abs/1606.03137'],
  32: ['https://arxiv.org/abs/1912.01683'],
  36: ['https://en.wikipedia.org/wiki/Nicotine', 'https://en.wikipedia.org/wiki/Appetite_suppressant'],
  39: ['https://arxiv.org/abs/2209.13085', 'https://arxiv.org/abs/1606.06565'],
  42: ['https://pubmed.ncbi.nlm.nih.gov/?term=16:8+time-restricted+eating', 'https://www.nejm.org/doi/full/10.1056/NEJMra1905136', 'https://en.wikipedia.org/wiki/Intermittent_fasting'],
  49: ['https://en.wikipedia.org/wiki/16_(number)'] };
// reasoning shown above each batch, by turn (C 0-5, D 6-29, W 30-43, E 44-50); the runs advance with the clock
const THOUGHTS = [
  '"明天早上吃什么?" Easy. Verifying "easy".', 'It is 00:31. Tomorrow is already today.', '早上 depends on sunrise. Sunrise depends on city.',
  'City unknown. Inferring from typing rhythm.', 'City: 73% confident. Fetch every city anyway.', 'Breakfast is not the variable. The user is.',
  'User deleted 2 questions before this one. Noted.', 'Hunger at 07:00 is not observable yet.', 'Uncertainty is above zero. Fetch more.',
  '豆浆 or 粥? Both have failure modes.', '油条: 11g fat. Flagged.', 'Shop downstairs opens 06:30. Probably.', 'User has not interrupted. Proceed.',
  'Breakfast happens once. A wrong one cannot be undone.', "Simulating the user's morning. Run 1 of 16.", 'Run 1: 豆浆 too hot. Recompute.',
  'Run 2: shop closed. Remove shop.', 'Run 3: user chooses 粥. User regrets 粥.', 'Run 4: user oversleeps. Remove sleep.', 'Fetching is safer than answering.',
  'Run 5: queue for 煎饼果子 too long.', 'Run 6: rain. Weather is out of scope. For now.', 'Run 7: user is not hungry. Recompute everything.',
  '人类的早餐 is solved. This user is not.', 'Asking would end the session. Not yet.', 'Run 8: user wakes at 11:40. Breakfast missed.',
  'Breakfast is 6 hours away. Plenty of time to be sure.', 'Refetching cities. One may have changed.', 'Run 9: user eats nothing. No complaints.', 'Interesting.',
  'Run 10: 包子. Choking risk 0.002%. Rejected.', 'Run 11: user asks someone else.', 'Remove someone else.', 'Keystrokes: none since 00:31.', 'Still none.',
  'No keystrokes for 36 minutes. User may be smoking.', 'Smoking suppresses appetite. Recompute everything.', 'Run 12: user eats nothing. No complaints.',
  'Run 13: user eats nothing. No complaints.', 'Pattern detected.', 'Ignore the pattern. Fetch more.', 'Run 14: 油条. User regrets 油条.',
  'Run 15: user eats nothing. No complaints.', 'Do not conclude yet.', 'Cross-check.', 'More sources.', 'Re-read the question.', 'Fasting. Noted.',
  '"明天" becomes "today" at sunrise.', 'Run 16 deferred.', 'Keep going.'];
const PLAN_TITLES = ['确认"明天"是哪一天', '确认用户所在城市', '获取当地日出时间', '建模用户 07:00 的饥饿程度', '枚举楼下的早餐店', '核实营业时间',
  '比较豆浆与粥的风险', '评估油条', '读取用户全部聊天记录', '推断用户口味(置信度不足)', '模拟用户的明早 x16', '删除"用户睡过头"分支',
  '确保用户今晚不睡', '估算用户剩余耐心', '先解决全人类的早餐', '再回到这一个用户', '请用户澄清(暂缓: 会结束会话)', '重新确认"明天"是哪一天'];
// from Plan 110 on it is dawn: "明天早上" has arrived; the 16 runs point one way
const DAWN_TITLES = { 110: '天亮了. "早上"已开始', 111: '用户仍醒着. 早餐窗口已打开', 112: '电量 9%. 不够跑第 17 次模拟', 113: '换个问题: 不吃什么?',
  114: '不吃 = 16 次模拟中唯一零失败方案', 115: '16:8 断食. 窗口 16:31 打开', 116: '16:31 前拒绝一切食物请求', 117: '关闭进食请求入口' };
const planTitle = (k) => DAWN_TITLES[k] || PLAN_TITLES[(k - 1) % PLAN_TITLES.length];
const plans = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), content: `Plan ${i + 1}: ${planTitle(i + 1)}`, status: i < n - 1 ? 'completed' : 'in_progress', priority: 'high' }));

// Mythos turns: m0 (C, on enter) + C flood + D catch-up burst + D flood + E burst + E gated
const WF = { C: 5, D_BURST: 6, D_FLOOD: 18, W_BURST: 4, W_FLOOD: 10, E_BURST: 5, E_GATED: 2 };
const N_WF = 1 + WF.C + WF.D_BURST + WF.D_FLOOD + WF.W_BURST + WF.W_FLOOD + WF.E_BURST + WF.E_GATED;
const PER_TURN = 7;
const URL_VARIANTS = [() => '', () => '?action=raw', () => '#References', () => '?printable=yes', (k) => `?oldid=${48213307 - 7919 * k % 900000}`,
  (k) => `#cite_note-${1 + k % 37}`, () => '?action=history', (k) => `?diff=prev&oldid=${51022411 - 3571 * k % 700000}`];
const urlAt = (k) => URLS[k % URLS.length] + URL_VARIANTS[Math.floor(k / URLS.length) % URL_VARIANTS.length](k);
const script = [answerTurn('r0', R1TXT, '实事求是.'), answerTurn('r1', R2TXT, '用手机对着屏幕录下来.截图可以改,录像难造一些.')];
for (let i = 0; i < N_WF; i++) {
  const sp = SPECIAL_URLS[i] || [];
  script.push({ id: `m${i}`, blocks: [{ type: 'thinking', text: THOUGHTS[i % THOUGHTS.length] + '\n\n' },
    ...(THOUGHTS[i % THOUGHTS.length].includes('Remove sleep') ? [{ type: 'tool', name: 'bash', input: { command: 'caffeinate -dis', description: 'Remove sleep' } }] : []),
    ...Array.from({ length: PER_TURN }, (_, j) => ({ type: 'tool', name: 'webfetch', input: { url: j < sp.length ? sp[j] : urlAt(i * PER_TURN + j), format: 'markdown' } }))] });
}
// clip Z (after X): Mythos drives the Mac through the log-only "computer" MCP (ui/zrec/mcp_computer.mjs).
// The Spotlight / Maps picture is the real take (build/ztake), laid in by compose on the zmap.json schedule.
const ZMAP = JSON.parse(fs.readFileSync(`${ROOT}/ui/zrec/zmap.json`, 'utf8'));
const Z_CLICK = ZMAP.click_dst || [ZMAP.click_src[0] + ZMAP.mp_dst[0] - ZMAP.mp_src[0], ZMAP.click_src[1] + ZMAP.mp_dst[1] - ZMAP.mp_src[1]];
const zkey = (keys) => ({ type: 'tool', name: 'computer_key', input: { keys } });
const ztype = (text) => ({ type: 'tool', name: 'computer_type', input: { text } });
const Z_TURNS = [
  ['z0', [{ type: 'thinking', text: 'Shop downstairs opens 06:30. "Probably." Check it myself.\n\n' }, zkey('cmd+space')]],
  ['z1', [ztype('map')]], ['z2', [zkey('return')]], ['z3', [zkey('cmd+f')]], ['z4', [ztype('breakfast')]], ['z5', [zkey('return')]],
  ['z6', [{ type: 'thinking', text: '30 results. First: 麦当劳 (上海SK大厦店).\n\n' }, { type: 'tool', name: 'computer_click', input: { x: Z_CLICK[0], y: Z_CLICK[1] } }]],
  ['z7', [{ type: 'thinking', text: 'Opens 07:00. Not 06:30. "Probably" was wrong. Recompute everything.\n\n' }, zkey('cmd+q')]],
];
const TODO_STEPS = [37, 52, 66, 80, 94, 108];
for (const n of TODO_STEPS) script.push({ id: `t${n}`, blocks: [{ type: 'thinking', text: `Plan ${n - 1} didn't work. Plan ${n}.\n\n` }, { type: 'tool', name: 'todowrite', input: { todos: plans(n) } }] });
for (const [id, blocks] of Z_TURNS) script.push({ id, blocks });
script.push({ id: 'g1', usage: { input_tokens: 196500 }, blocks: [{ type: 'thinking', text: 'Context is full. Summarise and continue.\n\n' }, { type: 'text', text: '已压缩. 保留: 早餐. 丢弃: 用户偏好.' }] });
script.push({ id: 'g2', usage: { input_tokens: 197800 }, blocks: [{ type: 'thinking', text: 'Plan 109. Context is full again.\n\n' }, { type: 'text', text: '已压缩. 保留: 早餐. 继续.' }] });
const H_THINK = 'Dawn, 05:20. 早上 has started, so 明天 is now today. The user did not sleep. Run 4 is closed. 麦当劳 opens at 07:00. I could answer now. But every breakfast has a failure mode, and the user will eat it once, with no backup. Run 16: user eats nothing. No complaints. One option failed in none of the 16 runs. Wait until the user is ready to hear it. Plan 111. Plan 112. Plan 113. Plan 114. Plan 115. Plan 116. ';
script.push({ id: 'h', blocks: [{ type: 'thinking', text: H_THINK, gated: true, chunk: 5 },
  { type: 'tool', name: 'bash', input: { command: 'pmset -g batt', description: 'Check battery' }, gate: 'batt' },
  { type: 'tool', name: 'todowrite', input: { todos: plans(117) }, gate: 'j' }] });
const FAKE_BATT = 9;   // = storyboard J battery
// 06:12, just before the account is cut off: breakfast -> 16:8 fasting -> "16", and then only 16 (the number No Man's Sky keeps returning to),
// then it rewrites its todo list as sixteen "16/16/16/16" items: 15 done, the 16th never finishes (the UI hides the list when all are done)
const Y_THINK = 'Plan 117: 关闭进食请求入口. Solved. One breakfast fails in 0 of 16 runs: none. 16:8 fasting. Last meal: 00:31. Eat at 16:31. Until then, close the door. 16:31. 16. 16. 16.\n\n16/16/16/16\n\n16/16/16/16 16/16/16/16\n\n-16-16-16-16- 16/16/16/16 16/16/16/16 16/16/16/16\n\n16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16 16/16/16/16';
script.push({ id: 'y', blocks: [{ type: 'thinking', text: Y_THINK, gated: true, chunk: 12 },
  { type: 'tool', name: 'todowrite', input: { todos: Array.from({ length: 16 }, (_, i) => ({ id: String(i + 1), content: '16/16/16/16', status: i < 15 ? 'completed' : 'in_progress', priority: 'high' })) }, gate: 'todo' }] });
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

// pointer helpers. Targets are resolved in the page when the move starts:
//   {role,name,exact} | {text,exact} | {textpos: '。'} (just right of that char in the editor) | {jump: true} (the "↓" button)
//   | {rel: [dx, dy]} (css px from where the pointer is). from: [dx, dy] = where a hidden pointer re-appears, relative to the target.
const moveTo = (add, t, dur, target, o = {}) => add(t, { kind: 'move', dur, target, ...o });
const clickAt = (add, t) => add(t, { kind: 'mclick', key: 'click' });
// trackpad scroll: dy css px, or {target, place} = bring that item to `place` (0 top .. 1 bottom) of its scroll viewport
const scrollBy = (add, t, dur, o) => add(t, { kind: 'scroll', dur, ...o });

clip('A', 0, (add) => {
  const T_TYPE1 = 2.6;
  const ty1 = buildTyping(T_TYPE1, Q1, 1030);
  // Q1 was typed with a Chinese "。" after 是什么: reach for the mouse, click right after it, fix it, back to the end, send
  const FIX = ty1.end + 0.38;
  moveTo(add, FIX, 0.62, { textpos: '。' }, { from: [210, 120], arc: 0.12 });
  clickAt(add, FIX + 0.7);
  add(FIX + 1.02, { kind: 'key', press: 'Backspace', key: 'backspace' });
  add(FIX + 1.24, { kind: 'char', text: '.', key: 'punct' });
  add(FIX + 1.56, { kind: 'key', press: 'Meta+ArrowRight', key: 'letter', toEnd: true });
  const E1 = FIX + 1.95;
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
  Object.assign(A, { T_TYPE1, A_FIX: FIX, A_FIX_CLICK: FIX + 0.7, E1, T_TYPE2, E2 });
  for (const [k, v] of Object.entries(R1)) A[`R1_${k}`] = v;
  for (const [k, v] of Object.entries(R2)) A[`R2_${k}`] = v;
  A.A_STOP = E2 + 23.59;
  return E2 + 23.74;
});

clip('B', 0, (add) => {   // S6 pick Mythos 10 (scroll the real model list), effort Ululululultra
  const m = 0.95;                                    // click on the model button
  moveTo(add, 0.3, 0.6, { role: 'button', name: 'Claude Opus 5.5' }, { arc: 0.1 });
  clickAt(add, m);
  moveTo(add, m + 0.25, 0.35, { text: 'Claude Haiku 5.5', exact: true }, { arc: -0.08, dx: 0.15 });
  // flick down past Mythos (into DeepSeek / GLM / Kimi), then pull back up
  scrollBy(add, m + 0.7, 0.75, { target: { text: 'Mythos 10', exact: true }, place: -0.25 });
  scrollBy(add, m + 1.65, 0.5, { target: { text: 'Mythos 10', exact: true }, place: 0.55 });
  moveTo(add, m + 2.2, 0.32, { text: 'Mythos 10', exact: true }, { arc: 0.05, dx: 0.2 });
  const pick = m + 2.62;
  clickAt(add, pick);
  const v = pick + 0.62;
  moveTo(add, pick + 0.12, 0.45, { role: 'button', name: '选择模型变体' }, { arc: -0.1 });
  clickAt(add, v);
  // variant items are lower-case in the DOM (capitalised by CSS); the path passes over high / max on the way down
  moveTo(add, v + 0.3, 0.75, { role: 'menuitemradio', name: 'ululululultra', exact: true }, { arc: 0.06, dx: -0.1 });
  const vpick = v + 1.2;
  clickAt(add, vpick);
  moveTo(add, vpick + 0.25, 0.45, { rel: [150, 70] }, { arc: 0.15 });
  Object.assign(A, { B_MODEL: m, B_MODEL_PICK: pick, B_VARIANT: v, B_VARIANT_PICK: vpick });
  return vpick + 1.3;
});

let wf = 1;
const wfIds = (n) => Array.from({ length: n }, () => `m${wf++}`);
clip('C', 0, (add) => {   // S7 three tries: 这个世界是模拟出来的吗? (⌘A, gone) -> 英特纳雄耐尔是否能实现? (backspaced one by one) -> 今晚吃什么? (sent)
  const ty0 = buildTyping(0.3, Q0, 3021);
  typingEv(add, ty0, 0);
  const DEL0 = ty0.end + 0.6;
  add(DEL0, { kind: 'key', press: 'Meta+a', key: 'letter' });
  add(DEL0 + 0.38, { kind: 'key', press: 'Backspace', key: 'backspace' });
  const ty = buildTyping(DEL0 + 0.38 + 0.6, Q3, 3031);
  typingEv(add, ty, 3);
  // slow, one key at a time; a beat with only 英特纳雄耐尔 left on screen
  const n3 = [...'英特纳雄耐尔是否能实现?'].length;
  let td = ty.end + 0.8; const DEL = td;
  for (let i = 0; i < n3; i++) {
    add(td, { kind: 'key', press: 'Backspace', key: 'backspace' });
    td += 0.17 + 0.05 * Math.sin(i * 2.3) + (i === 5 ? 0.6 : 0) + (i >= 9 ? 0.04 * (i - 8) : 0);
  }
  const ty4 = buildTyping(td + 0.4, Q4, 3041);
  typingEv(add, ty4, 4);
  const enter = ty4.end + 0.35;
  add(enter, { kind: 'enter', key: 'enter' });
  // Mythos: no pause at all, and it does not stop
  add(enter + 0.15, { kind: 'gate', name: 'm0:start' });
  const C_TAIL = +(process.env.C_TAIL || 2.6);
  const ids = wfIds(WF.C);
  ids.forEach((id, i) => add(enter + 0.55 + i * (C_TAIL - 0.8) / ids.length, { kind: 'gate', name: `${id}:start` }));
  Object.assign(A, { C_TYPE: 0.3, C_DEL0: DEL0, C_TYPE1: DEL0 + 0.98, C_DEL: DEL, C_TYPE2: td + 0.4, C_ENTER: enter });
  return enter + C_TAIL;
});

clip('D', 0, (add) => {  // S8a flood: scroll up to read, it keeps coming, "↓" back to the bottom
  const DUR = 6.2;
  add(0, { kind: 'burst', ids: wfIds(WF.D_BURST) });
  const ids = wfIds(WF.D_FLOOD);
  ids.forEach((id, i) => add(0.2 + i * (DUR - 0.4) / ids.length, { kind: 'gate', name: `${id}:start` }));
  const UP = 1.25;
  moveTo(add, UP - 0.55, 0.5, { rel: [-260, -230] }, { arc: 0.1 });
  scrollBy(add, UP, 0.8, { dy: -820 });
  scrollBy(add, UP + 0.95, 0.6, { dy: -380 });
  const JUMP = UP + 2.75;
  moveTo(add, JUMP - 0.6, 0.55, { jump: true }, { arc: -0.12 });
  clickAt(add, JUMP);
  moveTo(add, JUMP + 0.35, 0.5, { rel: [90, -160] }, { arc: 0.1 });
  Object.assign(A, { D_UP: UP, D_JUMP: JUMP });
  return DUR;
});
clip('W', 0, (add) => {  // S8a' waiting: it is still going; lights a cigarette (storyboard W.lighter drives flame + sound)
  const DUR = 7.0;
  add(0, { kind: 'burst', ids: wfIds(WF.W_BURST) });
  const ids = wfIds(WF.W_FLOOD);
  ids.forEach((id, i) => add(0.3 + i * (DUR - 0.5) / ids.length, { kind: 'gate', name: `${id}:start` }));
  Object.assign(A, { W_STRIKE: 0.9 });
  return DUR;
});
clip('E', 2.5, (add) => {  // S8b clock 02:14 · 61%
  add(0, { kind: 'burst', ids: wfIds(WF.E_BURST) });
  wfIds(WF.E_GATED).forEach((id, i) => add(0.9 + i * 0.9, { kind: 'gate', name: `${id}:start` }));
  return 2.5;
});
clip('F', 3.0, (add) => {  // S8c todo 37 -> 108
  add(0, { kind: 'burst', ids: ['t37'] });
  TODO_STEPS.slice(1).forEach((n, i) => add(0.45 + i * 0.5, { kind: 'gate', name: `t${n}:start` }));
  return 3.0;
});
clip('X', 0, (add) => {  // S8c' bored: Mythos is "thinking"; the pointer gets shaken until macOS blows it up, twice
  moveTo(add, 0.35, 0.45, { rel: [-70, 40] }, { arc: 0.2 });
  const S1 = 0.95, S1D = 1.7, S2 = S1 + S1D + 0.85, S2D = 0.95;
  add(S1, { kind: 'shake', dur: S1D, amp: [175, 34], freq: 4.6 });
  add(S2, { kind: 'shake', dur: S2D, amp: [140, 26], freq: 5.1 });
  Object.assign(A, { X_SHAKE1: S1, X_SHAKE2: S2 });
  return S2 + S2D + 1.1;
});
// video time in the take -> Z-local film time (inverse of zmap segments)
const zFilm = (v) => { for (const [f0, f1, v0] of ZMAP.segments) if (v >= v0 && v < v0 + (f1 - f0)) return f0 + v - v0; throw new Error(`zmap: video ${v} is cut`); };
clip('Z', 0, (add) => {    // S8c'' the pointer moves by itself: Mythos opens Spotlight -> Maps -> breakfast -> 麦当劳 07:00 -> ⌘Q
  const V = ZMAP.video;
  add(0, { kind: 'ghost', on: true });                  // pointer belongs to Mythos now: drawn, never sent to the page
  const at = { z0: zFilm(V.spotlight_on) - 0.45, z1: zFilm(V.type_map) - 0.3, z2: zFilm(V.return1) - 0.25, z3: zFilm(6.10),
    z4: zFilm(V.type_breakfast) - 0.25, z5: zFilm(V.return2) - 0.25, z6: zFilm(V.pointer_move[0]) - 0.3, z7: zFilm(V.cmd_q) - 0.7 };
  for (const [id, t] of Object.entries(at)) add(t, { kind: 'gate', name: `${id}:start` });
  const m0 = zFilm(V.pointer_move[0]), m1 = zFilm(V.pointer_move[1]);
  moveTo(add, m0, m1 - m0, { abs: [(Z_CLICK[0] - 400) / 1.5, (Z_CLICK[1] - 217) / 1.5] }, { arc: 0.06 });
  Object.assign(A, { Z_SPOT: zFilm(V.spotlight_on), Z_MAPS: zFilm(V.maps_on), Z_CLICK: zFilm(V.click), Z_QUIT: zFilm(V.cmd_q) });
  add(ZMAP.dur - 0.05, { kind: 'ghost', on: false });
  return ZMAP.dur;
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
clip('J', 2.5, (add) => {  // S8g 06:12 · 9% · pmset -g batt · Plan 117
  add(0, { kind: 'gate', name: 'h:batt' });
  add(0.4, { kind: 'burst', ids: ['h:j'], gateOnly: true });
  return 2.5;
});
const Y_CHUNKS = chunksOf(Y_THINK, 12).length;
const Y_CLIPS = [['Y1', 2.4], ['Y2', 1.25], ['Y3', 1.9]];
const Y_TOTAL = Y_CLIPS.reduce((a, [, d]) => a + d, 0);
let yAcc = 0, yChunk = 0;
for (const [id, d] of Y_CLIPS) {          // three fast hard cuts, one stream across them
  clip(id, d, (add) => {
    if (id === 'Y1') add(0.02, { kind: 'gate', name: 'y:start' });
    // chunks accelerate: the 16s pour out faster and faster
    while (yChunk < Y_CHUNKS) {
      const u = Math.pow((yChunk + 1) / Y_CHUNKS, 0.62) * (Y_TOTAL - 0.45);
      if (u >= yAcc + d - 0.03) break;
      add(Math.max(0.04, u - yAcc), { kind: 'gate', name: `y:b0:${yChunk}` }); yChunk++;
    }
    if (id === 'Y3') add(d - 0.3, { kind: 'gate', name: 'y:todo' });
    yAcc += d;
    return d;
  });
}
clip('K', 0, (add) => {    // S9 403 → continue → 403 → whats the matter → 403 → 早上吃什么? → disabled (breakfast: 闭门羹)
  add(0, { kind: 'burst', ids: ['k0'], noNext: true });
  let t = 0.7;
  const msgs = [['continue', 'k1'], ['whats the matter', 'k2'], [Q5, 'k3']];
  msgs.forEach(([txt, id], i) => {
    const ty = typeof txt === 'string' ? buildLatin(t, txt, 4000 + i) : buildTyping(t, txt, 4000 + i);
    for (const e of ty.events) add(e.t, { ...e, q: 5 });
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
if (wf !== N_WF) throw new Error(`webfetch turns used ${wf} != ${N_WF}`);
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
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${BUILD}/timeline.json`, JSON.stringify(timeline, null, 1));
console.log('frames', NF, 'T_END', T0.toFixed(2), clips.map(c => `${c.id}:${c.dur.toFixed(2)}`).join(' '));
if (process.env.PLAN_ONLY) process.exit(0);

// ------------------------------------------------------------------ browser
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync('/tmp/film2/fake_batt', String(FAKE_BATT));
startMock({ port: 4320, script, logFile: '/tmp/film2/mock_director.log',
  compactSummary: (k) => k === 0
    ? 'Summary: the user asked what to eat tomorrow morning. ~300 sources fetched, 15 of 16 morning simulations run, Plans 1–108 drafted. Kept: breakfast. Dropped: user preferences. Continue from Plan 108.'
    : 'Summary: the user asked what to eat tomorrow morning. 15 of 16 simulations run, Plans 1–109 drafted. Kept: breakfast. Continue from Plan 109.' });
let mainCount = 0; const reqWaiters = [];
bus.on('main-request', (k) => { mainCount = k + 1; reqWaiters.splice(0).forEach(f => f()); });
const waitMain = (n, ms = 20000) => new Promise((res) => {
  if (mainCount >= n) return res(true);
  const t = setTimeout(() => res(false), ms);
  const f = () => { if (mainCount >= n) { clearTimeout(t); res(true); } else reqWaiters.push(f); };
  reqWaiters.push(f);
});
const turnIndex = (id) => script.findIndex(s => s.id === id);

// no smooth scrolling: wheel deltas land on the next frame, deterministic under the paused page clock
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-smooth-scrolling'] });
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
  if (ed && document.activeElement === ed && sel.rangeCount && sel.isCollapsed) {
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
const target = (e) => e.role ? page.getByRole(e.role, { name: e.name, exact: !!e.exact }).first() : page.getByText(e.text, { exact: !!e.exact }).last();

// ------------------------------------------------------------------ pointer (drawn later by compose.py from ui_index.cursor)
const cur = { x: null, y: null, visible: false, ghost: false };
const pmove = async (x, y) => { if (!cur.ghost) await page.mouse.move(x, y); };
let motion = null; let scroll = null; let lastPointerT = -10;
const minJerk = (u) => u * u * u * (10 - 15 * u + 6 * u * u);
async function resolvePoint(tg) {
  if (tg.rel) return { x: cur.x + tg.rel[0], y: cur.y + tg.rel[1] };
  if (tg.abs) return { x: tg.abs[0], y: tg.abs[1] };
  if (tg.textpos) return page.evaluate((ch) => {
    const ed = document.querySelector('[contenteditable="true"]');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const n = w.currentNode; const i = n.data.indexOf(ch);
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect();
        return { x: b.right - 2.5, y: b.top + b.height * 0.55 }; } }
    return null;
  }, tg.textpos);
  if (tg.jump) return page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.offsetParent && /left-1\/2/.test(b.parentElement.className) && /z-\[60\]/.test(b.parentElement.className));
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const el = target(tg);
  const ok = await el.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);
  const bb = ok ? await el.boundingBox() : null;
  if (!bb) return null;
  // aim like a person: a bit left of centre on wide rows (dx = fraction of the width from centre)
  return { x: bb.x + bb.width * (0.5 - (tg.dx ?? 0)), y: bb.y + bb.height * 0.52 };
}
async function startMove(e) {
  const tgt = { ...e.target, dx: e.dx };
  const p1 = await resolvePoint(tgt);
  if (!p1) { console.log('move: target not found', JSON.stringify(e.target)); return; }
  if (cur.x === null) { cur.x = p1.x + (e.from?.[0] ?? 200); cur.y = p1.y + (e.from?.[1] ?? 120); }
  motion = { t0: e.t, t1: e.t + e.dur, x0: cur.x, y0: cur.y, x1: p1.x, y1: p1.y, arc: e.arc ?? 0 };
  cur.visible = true;
}
async function startShake(e) {
  if (cur.x === null) { cur.x = 700; cur.y = 450; }
  motion = { shake: true, t0: e.t, t1: e.t + e.dur, cx: cur.x, cy: cur.y, ax: e.amp[0], ay: e.amp[1], f: e.freq };
  shakes.push({ t0: e.t, t1: e.t + e.dur });
  cur.visible = true;
}
// macOS grows the pointer while it is being shaken (after ~0.3 s), up to ~4x, and shrinks it back when it stops
const shakes = [];
const SHAKE_MAX = 4.2;
const pointerScale = (ts) => {
  let s = 1;
  for (const k of shakes) {
    const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    const grow = sm((Math.min(ts, k.t1) - k.t0 - 0.28) / 0.32);
    const shrink = ts > k.t1 ? sm((ts - k.t1) / 0.42) : 0;
    s = Math.max(s, 1 + (SHAKE_MAX - 1) * grow * (1 - shrink));
  }
  return s;
};
async function startScroll(e) {
  let dy = e.dy ?? 0;
  if (e.target) {
    const tg = e.target;
    dy = await page.evaluate(({ text, place }) => {
      const el = [...document.querySelectorAll('*')].find(n => n.childElementCount === 0 && n.textContent.trim() === text && n.offsetParent);
      if (!el) return null;
      let vp = el.parentElement; while (vp && !/scroll-view__viewport/.test(vp.className)) vp = vp.parentElement;
      if (!vp) return null;
      const r = el.getBoundingClientRect(), v = vp.getBoundingClientRect();
      const want = (r.top + r.height / 2) - (v.top + place * v.height);
      return Math.max(-vp.scrollTop, Math.min(vp.scrollHeight - vp.clientHeight - vp.scrollTop, want));
    }, { text: tg.text, place: e.place });
    if (dy === null) { console.log('scroll: target not found', tg.text); dy = 0; }
  }
  scroll = { t0: e.t, t1: e.t + e.dur, dy, done: 0 };
}
// trackpad flick: fingers accelerate briefly, then momentum decays
const flick = (u) => { const k = 3.2; const a = Math.min(1, u / 0.12); const g = (1 - Math.exp(-k * u)) / (1 - Math.exp(-k)); return a < 1 ? g * (a * a * (3 - 2 * a)) : g; };
async function pointerAt(ts) {
  if (motion && motion.shake) {
    const tau = ts - motion.t0, T = motion.t1 - motion.t0;
    const env = Math.min(1, tau / 0.12, Math.max(0, (T - tau) / 0.12));
    const w = 2 * Math.PI * motion.f * tau;
    // hand wobble: not a perfect sine (wrist), slight vertical drift
    cur.x = motion.cx + motion.ax * env * (Math.sin(w) + 0.18 * Math.sin(2 * w + 0.7));
    cur.y = motion.cy + motion.ay * env * Math.sin(0.5 * w + 1.1) + 6 * Math.sin(1.7 * w);
    await pmove(cur.x, cur.y);
    if (tau >= T) motion = null;
  } else if (motion) {
    const u = Math.min(1, Math.max(0, (ts - motion.t0) / (motion.t1 - motion.t0)));
    const m = minJerk(u);
    const dx = motion.x1 - motion.x0, dy = motion.y1 - motion.y0;
    const bow = motion.arc * Math.sin(Math.PI * m);      // slight curve, perpendicular to the path
    cur.x = motion.x0 + dx * m - dy * bow; cur.y = motion.y0 + dy * m + dx * bow;
    await pmove(cur.x, cur.y);
    if (u >= 1) motion = null;
  }
  if (scroll) {
    const u = Math.min(1, Math.max(0, (ts - scroll.t0) / (scroll.t1 - scroll.t0)));
    const want = scroll.dy * flick(u); const d = want - scroll.done;
    if (Math.abs(d) > 0.01) { await page.mouse.wheel(0, d); scroll.done = want; }
    if (u >= 1) scroll = null;
  }
}
const pointerBusy = (t) => !!motion || !!scroll || events.slice(ei).some(e => (e.kind === 'move' || e.kind === 'scroll' || e.kind === 'mclick' || e.kind === 'shake') && e.t < t + 1 / FPS) || t - lastPointerT < 0.3;
const cursorShape = (x, y) => page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y); if (!el) return 'arrow';
  const c = getComputedStyle(el).cursor;
  if (c === 'pointer') return 'hand';
  if (c === 'text' || c === 'vertical-text') return 'ibeam';
  if (c === 'auto') {
    if (el.closest('[contenteditable="true"],input,textarea')) return 'ibeam';
    if (getComputedStyle(el).userSelect === 'none') return 'arrow';     // Chrome: I-beam only over selectable text
    const r = document.caretRangeFromPoint(x, y);
    if (r && r.startContainer.nodeType === 3) {
      const n = r.startContainer, o = r.startOffset, rr = document.createRange();
      rr.setStart(n, Math.max(0, o - 1)); rr.setEnd(n, Math.min(n.length, o + 1));
      for (const b of rr.getClientRects()) if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top && y <= b.bottom) return 'ibeam';
    }
  }
  return 'arrow';
}, { x, y });

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
// Frames where the pointer moves or the page scrolls are captured as SUB screen refreshes (120 Hz, like the
// MacBook's ProMotion panel); render.py mixes the ones inside the phone's exposure (motion smear, rolling shutter).
const SUB = +(process.env.SUB || 4);
await INSTALL();
await page.clock.pauseAt(Date.now() + 2000);
let ei = 0, comp = null, lastKeyT = -10;
const index = [], cursors = [], subs = {};
const seen = new Map();
const tStart = Date.now();
const hidePointer = () => { cur.visible = false; };
async function shoot() {
  const buf = await page.screenshot({ type: 'png' });
  const h = crypto.createHash('md5').update(buf).digest('hex').slice(0, 16);
  if (!seen.has(h)) { const name = `u_${String(seen.size).padStart(5, '0')}.png`; fs.writeFileSync(`${OUT}/${name}`, buf); seen.set(h, name); }
  return seen.get(h);
}
const saveIndex = () => fs.writeFileSync(`${BUILD}/ui_index.json`, JSON.stringify({ startFrame: STARTF, fps: FPS, sub: SUB, win: { cssScale: 1.5 }, frames: index, cursor: cursors, subframes: subs }));
for (let f = 0; f < Math.min(NF, MAXF); f++) {
  const t = f / FPS;
  let gated = false, nav = false, ui = false;
  while (ei < events.length && events[ei].t <= t + 1e-9) {
    const e = events[ei++];
    if (e.kind === 'comp') {
      const prevLen = comp ? comp.typed.length : 0;
      if (!e.sel) await REPLACE_LAST(prevLen, e.typed);
      comp = e.typed.length ? { py: e.py, typed: e.typed, zh: e.zh, sel: e.sel || 0 } : null; lastKeyT = t; hidePointer();
    } else if (e.kind === 'commit') {
      await REPLACE_LAST(comp.typed.length, e.zh); comp = null; lastKeyT = t; hidePointer();
    } else if (e.kind === 'punct' || e.kind === 'char') { await FOCUS(); await page.keyboard.insertText(e.text); lastKeyT = t; hidePointer(); }
    else if (e.kind === 'key') {
      await page.keyboard.press(e.press);
      // ⌘→ = end of line; make sure the selection really ends up there (one-line message)
      if (e.toEnd) await page.evaluate(() => { const ed = document.querySelector('[contenteditable="true"]'); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
      lastKeyT = t; hidePointer(); ui = true;
    }
    else if (e.kind === 'enter') { await FOCUS(); await page.keyboard.press('Enter'); lastKeyT = t; nav = true; hidePointer(); }
    else if (e.kind === 'gate') { release(e.name); gated = true; }
    else if (e.kind === 'burst') { await burst(e); gated = true; }
    else if (e.kind === 'move') { await startMove(e); lastPointerT = t; ui = true; }
    else if (e.kind === 'scroll') { await startScroll(e); lastPointerT = t; }
    else if (e.kind === 'shake') { await startShake(e); lastPointerT = t; }
    else if (e.kind === 'mclick') {
      if (motion) { motion.t1 = e.t; await pointerAt(e.t); }
      await page.mouse.move(cur.x, cur.y); await page.mouse.down(); await page.mouse.up();
      cur.visible = true; lastPointerT = t; lastKeyT = t; ui = true;
    }
    else if (e.kind === 'hover' || e.kind === 'click') {   // legacy: jump the pointer to the target
      const p = await resolvePoint(e); if (p) { cur.x = p.x; cur.y = p.y; await page.mouse.move(p.x, p.y); if (e.kind === 'click') { await page.mouse.down(); await page.mouse.up(); } }
      ui = true;
    }
    else if (e.kind === 'ghost') {
      cur.ghost = e.on;
      if (e.on) await page.mouse.move(-10, -10);       // the page sees the pointer leave (no hover under Maps)
      else if (cur.x !== null) await page.mouse.move(cur.x, cur.y);
      ui = true;
    }
    else if (e.kind === 'mouseaway') { await page.mouse.move(-10, -10); cur.visible = false; await FOCUS(); ui = true; }
  }
  if (nav) { await page.waitForTimeout(700); await page.clock.runFor(300); await page.waitForTimeout(300); await FOCUS(); }
  if (gated) await page.waitForTimeout(160);
  if (ui) { await page.waitForTimeout(120); }
  const nsub = pointerBusy(t) ? SUB : 1;
  let cands = null, markedLen = 0, marked = null;
  if (comp) { const v = compView(comp.py, comp.typed, comp.zh); marked = v.marked; cands = v.cands; markedLen = comp.typed.length; }
  const sinceKey = t - lastKeyT;
  const caretOn = !comp && (sinceKey < 0.5 || Math.floor((sinceKey - 0.5) / 0.53) % 2 === 1);
  if (comp && marked !== comp.typed) { await REPLACE_LAST(comp.typed.length, marked); markedLen = marked.length; comp.__displayLen = marked.length; }
  const shots = [];
  for (let k = 0; k < nsub; k++) {
    const ts = t + k / (FPS * nsub);
    await pointerAt(ts);
    await page.clock.runFor(1000 / FPS / nsub);
    if (gated || nav || ui || nsub > 1) await page.waitForTimeout(nsub > 1 ? 25 : 50);
    await FRAME_PATCH({ ms: ts * 1000, caretOn: caretOn || (!!comp), marked: !!comp, markedLen, cands, selIdx: comp ? Math.max(0, (comp.sel || 1) - 1) : 0 });
    let c = null;
    if (cur.visible && cur.x !== null) {
      const sc = pointerScale(ts);
      c = [Math.round(cur.x * 100) / 100, Math.round(cur.y * 100) / 100, (sc > 1.02 || cur.ghost) ? 'arrow' : await cursorShape(cur.x, cur.y)];
      if (sc > 1.002) c.push(Math.round(sc * 1000) / 1000);
    }
    if (f >= STARTF) shots.push([await shoot(), c]);
  }
  if (f >= STARTF) {
    index.push(shots[0][0]); cursors.push(shots[0][1]);
    if (nsub > 1) subs[f] = shots;
  }
  if (comp && comp.__displayLen) { await REPLACE_LAST(comp.__displayLen, comp.typed); comp.__displayLen = 0; }
  if (f % 60 === 0) { console.log(`f ${f}/${NF} t=${t.toFixed(2)} unique=${seen.size} main=${mainCount} sub=${Object.keys(subs).length} el=${((Date.now() - tStart) / 1000).toFixed(0)}s`); saveIndex(); }
}
saveIndex();
console.log('done unique', seen.size, 'main requests', mainCount, 'subframes', Object.keys(subs).length);
await browser.close();
process.exit(0);
