import { Rig, makeTval, retime } from './pose.js';
import { Renderer } from './renderer.js';
import { Screen, valueAt } from './screen.js';
import { lighterState, lighterUniforms } from './lighter.js';

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let S, sb, rig, R, screen, tval, FPS;
let savedJSON = '';
let undoStack = [], redoStack = [], lastCo = { key: null, t: 0 };
let dirtyA = false;
const cur = { t: 0, f: 0, playing: false, ae: null, aeF: -1, loop: false, info: null, clipIdx: -1 };
let selKey = null;          // raw index into current clip's keys
let needs = true, busy = false, lastNow = 0;
const opts = { phys: true, blur: true, dof: true, hud: true, markers: true, half: false, mute: false };
const audio = new Audio('/build/audio.wav');
audio.preload = 'auto';
let audioOK = false;
audio.addEventListener('canplaythrough', () => { audioOK = true; });

// ---------------------------------------------------------------- setup
async function init() {
  S = await (await fetch('/api/state')).json();
  if (S.error) throw new Error(S.error);
  FPS = S.consts.FPS;
  tval = makeTval(S.anchors);
  sb = structuredClone(S.storyboard);
  savedJSON = JSON.stringify(sb);
  R = new Renderer($('#gl'), S.geom);
  R.onReady = () => { needs = true; };
  screen = new Screen(S, R);
  screen.tval = tval;
  await screen.init();
  rebuild();
  bindUI();
  tl.fit();
  requestAnimationFrame(tick);
  window.__ep1 = { seekFrame, play, pause, cur, opts, get rig() { return rig; }, get sb() { return sb; }, get busy() { return busy || needs; } };
}

function rebuild() {
  try { rig = new Rig(sb, S.anchors, S.noise, S.consts); void rig.focus; setErr(''); }
  catch (e) { setErr(e.message); return false; }
  cur.f = Math.min(cur.f, rig.nframes - 1);
  cur.t = Math.min(cur.t, rig.duration - 1 / FPS);
  cur.aeF = -1;
  if (editingInspector()) inspectorStale = true; else renderInspector();
  tl.draw();
  needs = true;
  return true;
}

let inspectorStale = false;
function editingInspector() {
  const a = document.activeElement;
  return !!a && /INPUT|TEXTAREA/.test(a.tagName) && $('#clipBox').contains(a);
}

function setErr(m) { $('#err').textContent = m ? '⚠ ' + m : ''; }

function updateDirty() {
  const d = JSON.stringify(sb) !== savedJSON;
  $('#status').textContent = d ? '未保存' : '已保存';
  $('#status').classList.toggle('dirty', d);
}

function mutate(fn, co) {
  const now = performance.now();
  if (!(co && lastCo.key === co && now - lastCo.t < 900)) {
    undoStack.push(JSON.stringify(sb)); if (undoStack.length > 300) undoStack.shift();
    redoStack = [];
  }
  lastCo = { key: co, t: now };
  fn(sb);
  if (JSON.stringify(sb) !== savedJSON) dirtyA = true;   // stored AE track no longer matches
  rebuild();
  updateDirty();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(sb)); sb = JSON.parse(undoStack.pop()); lastCo = { key: null, t: 0 };
  dirtyA = true; rebuild(); updateDirty();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(sb)); sb = JSON.parse(redoStack.pop()); lastCo = { key: null, t: 0 };
  dirtyA = true; rebuild(); updateDirty();
}

async function save() {
  const r = await fetch('/api/storyboard', { method: 'POST', body: JSON.stringify(sb) });
  const j = await r.json();
  if (!j.ok) { setErr('保存失败：' + j.error); return; }
  savedJSON = JSON.stringify(sb);
  updateDirty();
  $('#status').textContent = '已保存 ' + j.saved;
}

// ---------------------------------------------------------------- time & playback
function seek(t) {
  cur.t = clamp(t, 0, rig.duration - 1 / FPS);
  cur.f = Math.floor(cur.t * FPS + 1e-6);
  if (cur.playing) syncAudio();
  needs = true;
}
function seekFrame(f) { seek((clamp(f, 0, rig.nframes - 1) + 0.0001) / FPS); }

function loopRange() {
  if (!cur.loop) return [0, rig.duration];
  const c = rig.locate(cur.f).clip;
  return [c.t0, c.t0 + c.nf / FPS];
}

function syncAudio() {
  const end = Math.min(audio.duration || 0, rig.duration);
  if (cur.playing && !opts.mute && audioOK && cur.t < end - 0.05) {
    audio.currentTime = cur.t;
    audio.play().catch(() => {});
  } else audio.pause();
}

function play() { if (cur.t >= rig.duration - 2 / FPS) seek(0); cur.playing = true; lastNow = 0; syncAudio(); updateTransport(); }
function pause() { cur.playing = false; audio.pause(); updateTransport(); needs = true; }
function toggle() { cur.playing ? pause() : play(); }

function tick(now) {
  requestAnimationFrame(tick);
  const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 0;
  lastNow = now;
  if (cur.playing) {
    if (!audio.paused && !audio.ended && cur.t < audio.duration - 0.06) cur.t = audio.currentTime;
    else cur.t += dt;
    const [a, b] = loopRange();
    if (cur.t >= b - 1e-6) {
      if (cur.loop) { cur.t = a; syncAudio(); } else { cur.t = b - 1 / FPS; pause(); }
    }
    const f = Math.floor(cur.t * FPS + 1e-6);
    if (f !== cur.f) { cur.f = f; needs = true; }
  }
  if (needs && !busy) { needs = false; renderFrame(cur.f); }
}

function shutterTime(e, macro) {
  const RS = S.render;
  return macro ? RS.MACRO_SHUTTER : clamp(RS.EXPO * e / 1.2, 1 / 250, RS.EXPO);
}

function exposureFor(f, loc, L, macro) {
  const RS = S.render;
  let target = clamp(RS.AE_TARGET / Math.max(L, 1e-4), 0.55, 3.4);
  if (macro) target = Math.min(target, RS.MACRO_EXPO_CAP);
  let e;
  if (!dirtyA && S.exposure && f < S.exposure.length) e = S.exposure[f];
  else if (loc.lf === 0) e = target * 2.2;
  else if (cur.playing && cur.aeF >= 0 && f > cur.aeF && f - cur.aeF <= 15 && rig.locate(cur.aeF).index === loc.index) {
    e = cur.ae; const k = 1 - Math.exp(-(1 / FPS) / 0.33);
    for (let i = cur.aeF; i < f; i++) e *= Math.exp(Math.log(target / e) * k);
  } else e = target * (1 + 1.2 * Math.exp(-loc.t / 0.33));
  cur.ae = e; cur.aeF = f;
  return e;
}

function centreHit(p) { const s = -p.C[2] / p.fwd[2]; return [p.C[0] + s * p.fwd[0], p.C[1] + s * p.fwd[1]]; }

async function renderFrame(f) {
  busy = true;
  try {
    const loc = rig.locate(f), clip = loc.clip, u = loc.t;
    if (loc.index !== cur.clipIdx) { cur.clipIdx = loc.index; selKey = null; if (editingInspector()) inspectorStale = true; else renderInspector(); }
    const d = screen.describe(rig, loc);
    await screen.apply(d, !cur.playing);
    if (cur.playing && loc.index === 0) {
      const names = new Set(); for (let i = 1; i <= 24; i++) names.add(screen.uiName(f + i)); screen.prefetch(names);
    }
    const p = clip.pose(u);
    const focus = rig.focus[f];
    const base = { PP: S.consts.PP, fx: p.fx, focus, macro: p.macro, dawn: valueAt(clip.raw.dawn ?? 0, u),
                   lamp: S.render.LAMP, window: S.render.WINDOW, frame: f, phys: opts.phys, dof: opts.dof,
                   light: lighterUniforms(lighterState(clip.raw.lighter, u, rig.tval), p, focus) };
    const L = R.meter({ ...base, pose0: p, pose1: p, nt: 1, exposure: 1, gain: 0 });
    const expo = exposureFor(f, loc, L, p.macro);
    const shut = shutterTime(expo, p.macro);
    let pose0 = p, pose1 = p, nt = 1;
    if (opts.blur) {
      pose0 = clip.pose(u - shut / 2); pose1 = clip.pose(u + shut / 2);
      const a = centreHit(pose0), b = centreHit(pose1);
      const mv = Math.hypot(b[0] - a[0], b[1] - a[1]) / p.dist * p.fx;
      nt = clamp(Math.ceil(mv / 1.2), 1, 8);
    }
    R.draw({ ...base, pose0, pose1, nt, exposure: expo, gain: expo / 3 * (S.render.EXPO / shut) });
    cur.info = { loc, p, focus, expo, shut, nt, L, d };
    updateHUD(); updateLive(); tl.draw();
  } catch (e) { console.error(e); setErr(e.message); }
  finally { busy = false; }
}

// ---------------------------------------------------------------- HUD / live info
const tcode = (t) => { const f = Math.round(t * FPS); const s = Math.floor(f / FPS); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}·${String(f % FPS).padStart(2, '0')}`; };

function shotAt(clip, u) {
  let lab = '';
  for (const s of clip.raw.shots || []) { try { if (tval(s.t) <= u + 1e-6) lab = s.label; } catch {} }
  return lab;
}

function updateHUD() {
  const { loc } = cur.info, c = loc.clip;
  const mock = (c.raw.screen?.kind ?? 'mock') === 'mock';
  $('#hudL').innerHTML = `<b>${esc(c.id)}</b> ${esc(shotAt(c, loc.t))}${mock ? '<span class="tag">占位画面</span>' : ''}`;
  $('#hudR').textContent = `${tcode(cur.t)}  ·  段内 ${loc.t.toFixed(2)}s`;
  $('#tc').textContent = `${tcode(cur.t)} / ${tcode(rig.duration)}   帧 ${cur.f}   段 ${c.id} ${loc.t.toFixed(2)}s`;
}

function updateLive() {
  const { loc, p, focus, expo, shut, nt, L, d } = cur.info;
  const fp = p.dist / p.fx / S.consts.PP;
  $('#live').textContent =
    `段 ${loc.clip.id}  ${loc.t.toFixed(3)}s  帧 ${loc.lf}/${loc.clip.nf}\n` +
    `瞄准 x ${p.target[0].toFixed(0)}  y ${p.target[1].toFixed(0)}   距离 ${p.dist.toFixed(1)}mm\n` +
    `对焦 ${focus.toFixed(1)}mm  ${p.macro ? '微距镜头' : '主镜头 2x'}  ${fp.toFixed(3)} 屏幕像素/输出像素\n` +
    `测光 ${L.toFixed(4)}  曝光 ${expo.toFixed(2)}  快门 1/${Math.round(1 / shut)}  模糊采样 ${nt}\n` +
    `时钟 ${d.bar.clock}  电量 ${d.bar.battery}%`;
}

function updateTransport() {
  $('#bPlay').textContent = cur.playing ? '❚❚ 暂停' : '▶ 播放';
  $('#bLoop').classList.toggle('on', cur.loop);
  $('#bMute').textContent = opts.mute ? '声音 关' : '声音 开';
}

// ---------------------------------------------------------------- inspector
function curClipIndex() { return rig.locate(cur.f).index; }

const CLIP_FIELDS = [
  ['title', '标题', 'text'], ['dur', '时长 s', 'tnum'], ['clock', '时钟', 'clock'], ['battery', '电量', 'json'],
  ['dawn', '天亮 0–1', 'json'], ['stop_tap', '点停止 s', 'tnull'], ['seed', '手抖种子', 'int'], ['macro', '微距区间', 'json'],
];

function renderInspector() {
  if (!rig) return;
  const ci = curClipIndex(), c = sb.clips[ci], clip = rig.clips[ci];
  const mock = (c.screen?.kind ?? 'mock') === 'mock';
  let h = `<h3>镜头段 ${esc(c.id)} <span class="small">（第 ${ci + 1}/${sb.clips.length} 段，${mock ? '占位画面' : '真实界面帧'}）</span><span class="sp"></span>
    <button data-act="clipUp" title="上移">↑</button><button data-act="clipDown" title="下移">↓</button></h3>`;
  for (const [k, lab, type] of CLIP_FIELDS) {
    let v = c[k];
    if (type === 'json' || (type === 'clock' && typeof v === 'object')) v = JSON.stringify(v ?? null);
    if (type === 'tnull') v = v ?? '';
    h += `<div class="row"><label>${lab}</label><input data-clip="${k}" data-type="${type}" value="${esc(v ?? '')}"></div>`;
  }
  h += `<div class="row"><button data-act="clipAdd">＋ 在后面加一段</button><button data-act="clipDup">复制本段</button><button data-act="clipDel">删除本段</button></div>`;

  // keys
  h += `<h3>机位关键帧 <span class="sp"></span><button data-act="keyAdd" title="K">＋ 播放头</button><button data-act="keyDel" title="⌫">删除</button></h3>
    <table class="keys"><tr class="small"><td>t</td><td>x</td><td>y</td><td>d</td><td>偏航</td><td>俯仰</td><td>横滚</td></tr>`;
  clip.keyOrder.forEach((ri, si) => {
    const k = c.keys[ri];
    h += `<tr data-key="${ri}" class="${ri === selKey ? 'sel' : ''}"><td title="${esc(k.t)}">${clip.KT[si].toFixed(2)}${typeof k.t === 'string' ? '*' : ''}</td><td>${k.x}</td><td>${k.y}</td><td>${k.d}</td><td>${k.yaw}</td><td>${k.pitch}</td><td>${k.roll}</td></tr>`;
  });
  h += `</table><div class="small">* = 相对锚点（${Object.keys(S.anchors).slice(0, 4).join(', ')}…）的时间，编辑后仍保持相对</div>`;
  if (selKey !== null && c.keys[selKey]) {
    const k = c.keys[selKey];
    h += `<div class="grid2">` + [['t', 't (s)', tval(k.t).toFixed(3), 0.033], ['x', 'x', k.x, 1], ['y', 'y', k.y, 1], ['d', '距离', k.d, 1],
      ['yaw', '偏航', k.yaw, 0.1], ['pitch', '俯仰', k.pitch, 0.1], ['roll', '横滚', k.roll, 0.1]]
      .map(([f, lab, v, st]) => `<div class="row"><label>${lab}</label><input type="number" step="${st}" data-kf="${f}" value="${v}"></div>`).join('') + `</div>`;
  }

  // shots
  h += `<h3>镜头说明 <span class="sp"></span><button data-act="shotAdd">＋ 播放头</button></h3>`;
  (c.shots || []).forEach((s, i) => {
    h += `<div class="row"><input style="flex:0 0 74px" data-shot="${i}" data-f="t" value="${esc(s.t)}"><input data-shot="${i}" data-f="label" value="${esc(s.label)}"><button data-act="shotDel" data-i="${i}">×</button></div>`;
  });

  // cards
  if (mock) {
    const u = rig.locate(cur.f).t;
    h += `<h3>屏幕占位卡片 <span class="sp"></span><button data-act="cardAdd">＋ 播放头</button></h3>
      <div class="small">位置是屏幕像素（3024×1964，含刘海条）；新卡片放在当前取景中心。其它属性：until、w、size、color、bg、scroll（像素/秒）、type:"typing"+t0/t1、count:[a,b] 配合 {n}</div>`;
    (c.screen.cards || []).forEach((k, i) => {
      const { text, ...rest } = k;
      const act = u >= k.t && u < (k.until ?? 1e9);
      h += `<div class="card ${act ? 'active' : ''}"><div class="row"><textarea rows="${Math.min(6, (text || '').split('\n').length + 1)}" data-card="${i}" data-f="text">${esc(text || '')}</textarea></div>
        <div class="row"><input data-card="${i}" data-f="json" value="${esc(JSON.stringify(rest))}"><button data-act="cardDel" data-i="${i}">×</button></div></div>`;
    });
  }
  $('#clipBox').innerHTML = h;
}

function onInspectorInput(e) {
  const el = e.target, ci = curClipIndex();
  if (el.dataset.clip) {
    const k = el.dataset.clip, type = el.dataset.type;
    let v = el.value;
    try {
      const tnum = (x) => { const n = Number(x); return x.trim() !== '' && !isNaN(n) ? n : x.trim(); };
      if (type === 'tnum') { v = tnum(v); if (!(tval(v) > 0)) throw 0; }
      else if (type === 'int') { v = parseInt(v); if (isNaN(v) || v < 0 || v > 63) throw 0; }
      else if (type === 'tnull') { v = v.trim() === '' ? null : tnum(v); if (v !== null) tval(v); }
      else if (type === 'json') v = JSON.parse(v);
      else if (type === 'clock') { if (v.trim().startsWith('{')) { v = JSON.parse(v); if (!v.at) throw 0; } else if (!/^\d{1,2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) throw 0; }
      el.classList.remove('bad');
    } catch { el.classList.add('bad'); return; }
    mutate((s) => { s.clips[ci][k] = v; }, 'clip-' + ci + k);
    return;
  }
  if (el.dataset.kf && selKey !== null) {
    const f = el.dataset.kf; let v = parseFloat(el.value); if (isNaN(v)) return;
    mutate((s) => {
      const k = s.clips[ci].keys[selKey];
      if (f === 't') k.t = retime(k.t, v, S.anchors); else k[f] = v;
    }, 'kf-' + ci + selKey + f);
    return;
  }
  if (el.dataset.shot !== undefined) {
    const i = +el.dataset.shot, f = el.dataset.f; let v = el.value;
    if (f === 't') { const n = Number(v); if (v.trim() !== '' && !isNaN(n)) v = n; try { tval(v); el.classList.remove('bad'); } catch { el.classList.add('bad'); return; } }
    mutate((s) => { s.clips[ci].shots[i][f] = v; }, 'shot-' + ci + i + f);
    return;
  }
  if (el.dataset.card !== undefined) {
    const i = +el.dataset.card, f = el.dataset.f;
    if (f === 'text') { mutate((s) => { s.clips[ci].screen.cards[i].text = el.value; }, 'card-' + ci + i + f); return; }
    let o; try { o = JSON.parse(el.value); if (typeof o !== 'object' || o === null || typeof o.t !== 'number') throw 0; el.classList.remove('bad'); }
    catch { el.classList.add('bad'); return; }
    mutate((s) => { const text = s.clips[ci].screen.cards[i].text; s.clips[ci].screen.cards[i] = { ...o, text }; }, 'card-' + ci + i + f);
  }
}

function nextId() {
  const ids = new Set(sb.clips.map((c) => c.id));
  for (let i = 0; i < 26; i++) { const id = String.fromCharCode(65 + i); if (!ids.has(id)) return id; }
  let n = 1; while (ids.has('N' + n)) n++; return 'N' + n;
}

function onInspectorClick(e) {
  const b = e.target.closest('[data-act]');
  const row = e.target.closest('tr[data-key]');
  const ci = curClipIndex();
  if (row && !b) { selKey = +row.dataset.key; const clip = rig.clips[ci]; seek(clip.t0 + tval(sb.clips[ci].keys[selKey].t) + 0.0001); renderInspector(); return; }
  if (!b) return;
  const act = b.dataset.act, u = rig.locate(cur.f).t, clip = rig.clips[ci];
  if (act === 'keyAdd') addKeyAtPlayhead();
  else if (act === 'keyDel') deleteSelKey();
  else if (act === 'shotAdd') mutate((s) => { (s.clips[ci].shots ||= []).push({ t: r2(u), label: '新镜头说明' }); });
  else if (act === 'shotDel') mutate((s) => { s.clips[ci].shots.splice(+b.dataset.i, 1); });
  else if (act === 'cardAdd') {
    const p = clip.pose(u);
    mutate((s) => { const sc = (s.clips[ci].screen ||= { kind: 'mock', cards: [] }); (sc.cards ||= []).push({ t: r2(u), until: r2(u + 2), x: Math.round(p.target[0]), y: Math.round(p.target[1]), w: 600, size: 21, text: '新卡片' }); });
  }
  else if (act === 'cardDel') mutate((s) => { s.clips[ci].screen.cards.splice(+b.dataset.i, 1); });
  else if (act === 'clipAdd' || act === 'clipDup') {
    const src = sb.clips[ci];
    let nc;
    if (act === 'clipDup') { nc = structuredClone(src); nc.id = nextId(); nc.title = src.title + '（副本）'; if (nc.screen?.kind !== 'mock') nc.screen = { kind: 'mock', cards: [] }; if (typeof nc.clock === 'object') nc.clock = '00:40:00'; nc.dur = clip.dur; if (nc.stop_tap !== null && nc.stop_tap !== undefined) nc.stop_tap = clip.stop; nc.keys = nc.keys.map((k) => ({ ...k, t: r3(tval(k.t)) })); nc.macro = clip.macro.map(([a, b]) => [r3(a), r3(b)]); nc.shots = (nc.shots || []).map((x) => ({ ...x, t: r3(tval(x.t)) })); nc.af = { start: 'x1.3', intro: null, hunts: [{ t: 0, pts: [[0, 0.3], [0.25, -0.05], [0.45, 0]] }] }; }
    else {
      const raw = clip.smoothInterp(clip.dur);
      const k0 = { t: 0, x: Math.round(raw[0]), y: Math.round(raw[1]), d: r1(raw[2]), yaw: r2(raw[3]), pitch: r2(raw[4]), roll: r2(raw[5]) };
      const seeds = sb.clips.map((c) => c.seed ?? 0);
      nc = { id: nextId(), title: '新镜头', dur: 3.0, seed: (Math.max(...seeds) + 1) % 64, screen: { kind: 'mock', cards: [] },
             clock: typeof src.clock === 'string' ? src.clock : '06:20:00', battery: valueAt(src.battery ?? 89, clip.dur), dawn: valueAt(src.dawn ?? 0, clip.dur),
             stop_tap: null, macro: [], af: { start: 'x1.3', intro: null, hunts: [{ t: 0, pts: [[0, 0.3], [0.25, -0.05], [0.45, 0]]}] },
             shots: [{ t: 0, label: '新镜头说明' }], keys: [k0, { ...k0, t: 3.0 }] };
    }
    mutate((s) => { s.clips.splice(ci + 1, 0, nc); });
    seek(rig.clips[ci + 1].t0 + 0.0001);
  }
  else if (act === 'clipDel') {
    if (sb.clips.length <= 1 || !confirm(`删除段 ${sb.clips[ci].id}「${sb.clips[ci].title}」？（可撤销）`)) return;
    mutate((s) => { s.clips.splice(ci, 1); });
  }
  else if (act === 'clipUp' || act === 'clipDown') {
    const j = act === 'clipUp' ? ci - 1 : ci + 1;
    if (j < 0 || j >= sb.clips.length) return;
    mutate((s) => { const [c] = s.clips.splice(ci, 1); s.clips.splice(j, 0, c); });
    seek(rig.clips[j].t0 + 0.0001);
  }
}

// ---------------------------------------------------------------- key editing
function keyAtPlayhead(ci, u) {
  const keys = sb.clips[ci].keys;
  for (let i = 0; i < keys.length; i++) if (Math.abs(tval(keys[i].t) - u) < 0.6 / FPS) return i;
  return -1;
}

function addKeyAtPlayhead(co) {
  const loc = rig.locate(cur.f), ci = loc.index, u = loc.t;
  let i = keyAtPlayhead(ci, u);
  if (i >= 0) { selKey = i; renderInspector(); return i; }
  const raw = loc.clip.smoothInterp(u);
  const k = { t: r3(u), x: Math.round(raw[0]), y: Math.round(raw[1]), d: r1(raw[2]), yaw: r2(raw[3]), pitch: r2(raw[4]), roll: r2(raw[5]) };
  mutate((s) => { s.clips[ci].keys.push(k); }, co);
  selKey = sb.clips[ci].keys.length - 1;
  renderInspector();
  return selKey;
}

function deleteSelKey() {
  const ci = curClipIndex();
  if (selKey === null || sb.clips[ci].keys.length <= 1) return;
  const i = selKey; selKey = null;
  mutate((s) => { s.clips[ci].keys.splice(i, 1); });
}

function jumpKey(dir) {
  const loc = rig.locate(cur.f), clip = loc.clip;
  const ts = [];
  rig.clips.forEach((c) => c.KT.forEach((t, si) => { if (t >= -1e-6 && t <= c.dur + 1e-6) ts.push([c.t0 + t, c, c.keyOrder[si]]); }));
  ts.sort((a, b) => a[0] - b[0]);
  const t = cur.t;
  const cand = dir > 0 ? ts.find((x) => x[0] > t + 0.5 / FPS) : [...ts].reverse().find((x) => x[0] < t - 0.5 / FPS);
  if (cand) { seek(cand[0] + 0.0001); cur.clipIdx = rig.clips.indexOf(cand[1]); selKey = cand[2]; renderInspector(); }
  void clip;
}

// viewport: grab the screen
let drag = null;
function bindStage() {
  const st = $('#stage');
  st.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pause();
    const ci = curClipIndex();
    const ki = addKeyAtPlayhead('stage');
    drag = { x: e.clientX, y: e.clientY, ci, ki, alt: e.altKey };
    st.setPointerCapture(e.pointerId); st.classList.add('dragging');
  });
  st.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const sc = 1920 / st.clientWidth;
    const dx = (e.clientX - drag.x) * sc, dy = (e.clientY - drag.y) * sc;
    drag.x = e.clientX; drag.y = e.clientY;
    const fx = cur.info?.p.fx || S.consts.FX_MAIN;
    mutate((s) => {
      const k = s.clips[drag.ci].keys[drag.ki];
      if (drag.alt) { k.yaw = r2(k.yaw - dx * 0.01); k.pitch = r2(k.pitch + dy * 0.01); }
      else { const fp = k.d / fx / S.consts.PP; k.x = r1(k.x - dx * fp); k.y = r1(k.y - dy * fp); }
    }, 'stage');
  });
  const end = () => { if (drag) { drag = null; st.classList.remove('dragging'); renderInspector(); } };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  st.addEventListener('wheel', (e) => {
    e.preventDefault();
    pause();
    const ci = curClipIndex();
    const ki = addKeyAtPlayhead('wheel');
    mutate((s) => {
      const k = s.clips[ci].keys[ki];
      if (e.shiftKey) k.roll = r2(k.roll + (e.deltaY || e.deltaX) * 0.01);
      else k.d = r1(clamp(k.d * Math.exp(e.deltaY * 0.0015), 12, 900));
    }, 'wheel');
  }, { passive: false });
}

// ---------------------------------------------------------------- timeline
const tl = {
  v0: 0, v1: 100, el: null, ctx: null, W: 0, H: 0, drag: null,
  rows: { ruler: [0, 18], clips: [20, 50], shots: [52, 74], keys: [78, 104], audio: [110, 122] },
  init() {
    this.el = $('#tlc'); this.ctx = this.el.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(this.el.parentElement);
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', () => this.up());
    this.el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.el.addEventListener('dblclick', (e) => this.dbl(e));
    this.resize();
  },
  resize() {
    const r = this.el.parentElement.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.W = r.width; this.H = r.height;
    this.el.width = Math.round(r.width * dpr); this.el.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  },
  fit() { this.v0 = -0.5; this.v1 = rig.duration + 0.5; this.draw(); },
  x(t) { return (t - this.v0) / (this.v1 - this.v0) * this.W; },
  t(x) { return this.v0 + x / this.W * (this.v1 - this.v0); },
  keyHits() {
    const out = [];
    rig.clips.forEach((c, ci) => c.KT.forEach((t, si) => {
      if (t < -1e-6 || t > c.dur + 1e-6) return;
      out.push({ x: this.x(c.t0 + t), ci, ri: c.keyOrder[si], t: c.t0 + t });
    }));
    return out;
  },
  draw() {
    const c = this.ctx; if (!c || !rig) return;
    const W = this.W, H = this.H, R = this.rows;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#121318'; c.fillRect(0, 0, W, H);
    // ruler
    const span = this.v1 - this.v0;
    const step = [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60].find((s) => W / (span / s) > 50) || 60;
    c.font = '10px ui-monospace, Menlo, monospace'; c.fillStyle = '#7d8096'; c.strokeStyle = '#2c2e3a';
    for (let t = Math.ceil(this.v0 / step) * step; t < this.v1; t += step) {
      const x = this.x(t); c.beginPath(); c.moveTo(x, 12); c.lineTo(x, H); c.stroke();
      c.fillText(step < 1 ? t.toFixed(1) : tcode(t).slice(0, 5), x + 2, 10);
    }
    // clips
    const ciCur = rig.locate(cur.f).index;
    rig.clips.forEach((cl, i) => {
      const x0 = this.x(cl.t0), x1 = this.x(cl.t0 + cl.nf / FPS);
      const mock = (cl.raw.screen?.kind ?? 'mock') === 'mock';
      c.fillStyle = mock ? (i % 2 ? '#4a3a24' : '#5a4528') : '#2f3f5a';
      if (i === ciCur) c.fillStyle = mock ? '#7a5a2c' : '#3e5680';
      c.fillRect(x0 + 1, R.clips[0], Math.max(1, x1 - x0 - 2), R.clips[1] - R.clips[0]);
      c.save(); c.beginPath(); c.rect(x0 + 1, R.clips[0], Math.max(1, x1 - x0 - 2), 40); c.clip();
      c.fillStyle = '#e8e8f0'; c.font = '11px -apple-system, "PingFang SC", sans-serif';
      c.fillText(`${cl.id}  ${cl.raw.title || ''}`, x0 + 5, R.clips[0] + 13);
      c.fillStyle = '#a0a3b8'; c.fillText(`${(cl.nf / FPS).toFixed(1)}s`, x0 + 5, R.clips[0] + 26);
      // shots
      c.restore();
      for (const s of cl.raw.shots || []) {
        let t; try { t = tval(s.t); } catch { continue; }
        const x = this.x(cl.t0 + t);
        c.strokeStyle = '#6272a4'; c.beginPath(); c.moveTo(x, R.shots[0]); c.lineTo(x, R.shots[1]); c.stroke();
        c.save(); c.beginPath(); c.rect(x, R.shots[0], Math.max(0, x1 - x), 22); c.clip();
        c.fillStyle = '#b6b9cc'; c.font = '11px -apple-system, "PingFang SC", sans-serif'; c.fillText(s.label, x + 3, R.shots[0] + 14);
        c.restore();
      }
      // macro / stop
      for (const [a, b] of cl.macro) {
        const xa = this.x(cl.t0 + Math.max(a, 0)), xb = this.x(cl.t0 + Math.min(b, cl.dur));
        c.fillStyle = 'rgba(80,250,200,0.18)'; c.fillRect(xa, R.keys[0], xb - xa, R.keys[1] - R.keys[0]);
      }
      if (cl.stop !== null) { const x = this.x(cl.t0 + cl.stop); c.fillStyle = '#ff5555'; c.fillRect(x - 3, R.keys[1] - 7, 6, 6); }
    });
    // keys
    const ci = rig.locate(cur.f).index;
    for (const k of this.keyHits()) {
      const sel = k.ci === ci && k.ri === selKey, y = (R.keys[0] + R.keys[1]) / 2;
      c.fillStyle = sel ? '#ffb86c' : '#bd93f9';
      c.beginPath(); c.moveTo(k.x, y - 6); c.lineTo(k.x + 5, y); c.lineTo(k.x, y + 6); c.lineTo(k.x - 5, y); c.closePath(); c.fill();
    }
    c.fillStyle = '#7d8096'; c.font = '10px -apple-system, "PingFang SC", sans-serif'; c.textAlign = 'right';
    c.fillText('关键帧 ◆   微距 ▒   点停止 ■   滚轮缩放 · 双击段放大', W - 6, R.audio[1] - 2); c.textAlign = 'left';
    // audio
    const ae = Math.min(audio.duration || rig.duration, rig.duration);
    c.fillStyle = '#3a4a3a'; c.fillRect(this.x(0), R.audio[0], this.x(ae) - this.x(0), R.audio[1] - R.audio[0]);
    c.fillStyle = '#9fc79f'; c.fillText('音频', this.x(0) + 4, R.audio[1] - 2);
    // playhead
    const x = this.x(cur.t); c.strokeStyle = '#ff5555'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); c.lineWidth = 1;
  },
  down(e) {
    const r = this.el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    this.el.setPointerCapture(e.pointerId);
    if (y >= this.rows.keys[0] - 4 && y <= this.rows.keys[1] + 4) {
      const hit = this.keyHits().filter((k) => Math.abs(k.x - x) < 7).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
      if (hit) {
        pause(); seek(hit.t + 0.0001); cur.clipIdx = hit.ci; selKey = hit.ri; renderInspector();
        this.drag = { kind: 'key', ci: hit.ci, ri: hit.ri, moved: false };
        return;
      }
    }
    this.drag = { kind: 'scrub' };
    seek(this.t(x));
  },
  move(e) {
    if (!this.drag) return;
    const r = this.el.getBoundingClientRect(), x = e.clientX - r.left;
    if (this.drag.kind === 'scrub') { seek(this.t(x)); return; }
    const d = this.drag, cl = rig.clips[d.ci];
    const lt = clamp(Math.round((this.t(x) - cl.t0) * FPS) / FPS, 0, cl.dur);
    mutate((s) => { const k = s.clips[d.ci].keys[d.ri]; k.t = retime(k.t, lt, S.anchors); }, 'tlkey' + d.ci + d.ri);
    seek(cl.t0 + lt + 0.0001);
  },
  up() { this.drag = null; renderInspector(); },
  wheel(e) {
    e.preventDefault();
    const r = this.el.getBoundingClientRect(), x = e.clientX - r.left;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dt = e.deltaX / this.W * (this.v1 - this.v0); this.v0 += dt; this.v1 += dt;
    } else {
      const t = this.t(x), k = Math.exp(e.deltaY * 0.002);
      const span = clamp((this.v1 - this.v0) * k, 0.5, rig.duration + 20);
      const a = x / this.W; this.v0 = t - a * span; this.v1 = this.v0 + span;
    }
    this.draw();
  },
  dbl(e) {
    const r = this.el.getBoundingClientRect(), x = e.clientX - r.left;
    const t = this.t(x), c = rig.clips.find((c) => t >= c.t0 && t < c.t0 + c.nf / FPS);
    if (c) { const pad = c.dur * 0.04; this.v0 = c.t0 - pad; this.v1 = c.t0 + c.dur + pad; this.draw(); }
  },
};

// ---------------------------------------------------------------- physical render compare
async function physRender() {
  const loc = rig.locate(cur.f);
  if ((loc.clip.raw.screen?.kind ?? 'mock') === 'mock') { alert('这一段还是占位画面，物理渲染需要真实界面帧。'); return; }
  if (JSON.stringify(sb) !== savedJSON) { alert('物理渲染读取已保存的 storyboard.json，请先保存。'); return; }
  const b = $('#bPhysR'); b.textContent = '渲染中…'; b.disabled = true;
  try {
    const j = await (await fetch(`/api/phys?f=${cur.f}`, { method: 'POST' })).json();
    if (!j.ok) throw new Error(j.error);
    const img = $('#phys'); img.src = j.url; img.dataset.f = cur.f;
    img.classList.add('show'); $('#bCmp').classList.add('on');
  } catch (e) { setErr('物理渲染失败：' + e.message); }
  finally { b.textContent = '物理渲染本帧'; b.disabled = false; }
}
function setCompare(on) {
  const img = $('#phys');
  if (on && img.dataset.f !== String(cur.f)) { if (on) setErr(img.src ? '对比图是第 ' + img.dataset.f + ' 帧' : '先点“物理渲染本帧”'); }
  img.classList.toggle('show', on && !!img.src);
  $('#bCmp').classList.toggle('on', on && !!img.src);
}

// ---------------------------------------------------------------- bindings
function bindUI() {
  tl.init();
  bindStage();
  $('#clipBox').addEventListener('input', onInspectorInput);
  $('#clipBox').addEventListener('click', onInspectorClick);
  $('#clipBox').addEventListener('focusout', (e) => {
    if (inspectorStale && !(e.relatedTarget && $('#clipBox').contains(e.relatedTarget) && /INPUT|TEXTAREA/.test(e.relatedTarget.tagName))) {
      inspectorStale = false; setTimeout(renderInspector, 0);
    }
  });
  $('#bSave').onclick = save; $('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
  $('#bPlay').onclick = toggle;
  $('#bLoop').onclick = () => { cur.loop = !cur.loop; updateTransport(); };
  $('#bMute').onclick = () => { opts.mute = !opts.mute; syncAudio(); updateTransport(); };
  $('#bHelp').onclick = () => $('#help').classList.toggle('show');
  $('#help').onclick = () => $('#help').classList.remove('show');
  const tog = (id, k, after) => { $(id).onclick = () => { opts[k] = !opts[k]; $(id).classList.toggle('on', opts[k]); after && after(); needs = true; }; };
  tog('#oPhys', 'phys'); tog('#oBlur', 'blur'); tog('#oDof', 'dof');
  tog('#oMarkers', 'markers', () => { screen.markers = opts.markers; screen.winKey = null; });
  tog('#oHud', 'hud', () => $('#hud').classList.toggle('off', !opts.hud));
  tog('#oHalf', 'half', () => { const c = $('#gl'); c.width = opts.half ? 960 : 1920; c.height = opts.half ? 540 : 1080; });
  $('#bPhysR').onclick = physRender;
  $('#bCmp').onclick = () => setCompare(!$('#phys').classList.contains('show'));
  window.addEventListener('beforeunload', (e) => { if (JSON.stringify(sb) !== savedJSON) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    const k = e.key;
    if (k === ' ') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight') { e.preventDefault(); pause(); seekFrame(cur.f + (e.shiftKey ? FPS : 1)); }
    else if (k === 'ArrowLeft') { e.preventDefault(); pause(); seekFrame(cur.f - (e.shiftKey ? FPS : 1)); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault(); pause();
      const i = rig.locate(cur.f).index, j = clamp(k === 'ArrowUp' ? (rig.locate(cur.f).lf > 0 ? i : i - 1) : i + 1, 0, rig.clips.length - 1);
      seekFrame(rig.clips[j].f0);
    }
    else if (k === '[') jumpKey(-1);
    else if (k === ']') jumpKey(1);
    else if (k === 'k' || k === 'K') addKeyAtPlayhead();
    else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); deleteSelKey(); }
    else if (k === 'l' || k === 'L') { cur.loop = !cur.loop; updateTransport(); }
    else if (k === 'p' || k === 'P') physRender();
    else if (k === 'c' || k === 'C') { if (!e.repeat) setCompare(true); }
    else if (k === '?') $('#help').classList.toggle('show');
    else if (k === 'Home') seekFrame(0);
    else if (k === 'End') seekFrame(rig.nframes - 1);
  });
  window.addEventListener('keyup', (e) => { if ((e.key === 'c' || e.key === 'C') && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) setCompare(false); });
  updateTransport();
}

init().catch((e) => { console.error(e); setErr(e.message); });
