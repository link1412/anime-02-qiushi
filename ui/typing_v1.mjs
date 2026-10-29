// Deterministic typing schedule (Simplified Pinyin IME) for the two questions.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const SEG = {
  nijuede: 'ni jue de', zhege: 'zhe ge', shijieshang: 'shi jie shang', zuiweida: 'zui wei da', de: 'de',
  sigezi: 'si ge zi', shishenme: 'shi shen me', buxuyao: 'bu xu yao', liyou: 'li you', zhijie: 'zhi jie',
  huida: 'hui da', wo: 'wo', youren: 'you ren', hui: 'hui', buxin: 'bu xin', ruhe: 'ru he',
  zhengming: 'zheng ming', zheshinishuode: 'zhe shi ni shuo de', ne: 'ne',
};
const ALT = { // single-char homophones of first syllable, as an IME would list
  ni: ['你', '尼', '泥', '拟', '逆'], zhe: ['这', '着', '者', '折', '哲'], shi: ['是', '时', '事', '使', '市'],
  zui: ['最', '嘴', '醉', '罪', '蕞'], de: ['的', '得', '地', '德', '嘚'], si: ['四', '思', '死', '似', '丝'],
  bu: ['不', '部', '步', '布', '补'], li: ['里', '理', '李', '力', '立'], zhi: ['只', '知', '直', '之', '至'],
  hui: ['会', '回', '汇', '惠', '灰'], wo: ['我', '窝', '握', '沃', '卧'], you: ['有', '又', '由', '友', '右'],
  ru: ['如', '入', '乳', '儒', '茹'], zheng: ['正', '证', '整', '政', '争'], ne: ['呢', '哪', '讷', '那', '呐'],
};
const FULLALT = { // extra multi-char candidates for the full phrase
  nijuede: ['你觉得', '你觉', '你决', '你'], zhege: ['这个', '这', '者', '折'], shijieshang: ['世界上', '世界', '视界', '是'],
  zuiweida: ['最伟大', '最', '嘴', '醉'], de: ['的', '得', '地', '德'], sigezi: ['四个字', '四个', '思', '四'],
  shishenme: ['是什么', '是', '时', '事'], buxuyao: ['不需要', '不需', '不', '部'], liyou: ['理由', '里', '理', '李'],
  zhijie: ['直接', '之间', '只', '直'], huida: ['回答', '回', '会', '汇'], wo: ['我', '窝', '握', '沃'],
  youren: ['有人', '友人', '有', '又'], hui: ['会', '回', '汇', '惠'], buxin: ['不信', '不新', '不', '部'],
  ruhe: ['如何', '如', '入', '乳'], zhengming: ['证明', '正名', '正', '证'], zheshinishuode: ['这是你说的', '这是你', '这是', '这'],
  ne: ['呢', '哪', '讷', '那'],
};

function display(py, prefixLen) {
  const seg = SEG[py]; let out = ''; let n = 0;
  for (const ch of seg) { if (n >= prefixLen) break; out += ch; if (ch !== ' ') n++; }
  return out.trimEnd();
}
function candidates(py, phrase, prefixLen) {
  if (prefixLen >= py.length) return FULLALT[py].slice(0, 5);
  const sylls = display(py, prefixLen).split(' ');
  const m = sylls.length; const first = [...phrase].slice(0, m).join('');
  const s0 = SEG[py].split(' ')[0];
  const alts = (ALT[s0] || []).filter(c => c !== first);
  const list = [first, ...alts]; return [...new Set(list)].slice(0, 5);
}

// returns events: {t, kind, ...}; kinds: comp (marked text update), commit, punct, enter, key (for audio)
export function buildTyping(startT, seq, seed) {
  const rnd = mulberry32(seed); const ev = []; let t = startT;
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const dt = (mu, sd, lo, hi) => Math.min(hi, Math.max(lo, mu + sd * gauss()));
  for (const item of seq) {
    if (item.pause) { t += item.pause; continue; }
    if (item.punct) { t += dt(0.28, 0.08, 0.12, 0.6); ev.push({ t, kind: 'punct', text: item.punct, key: 'punct' }); continue; }
    const { py, zh, typo } = item;
    t += dt(0.32, 0.12, 0.12, 0.8);
    let typed = '';
    const typeLetters = (s) => { for (const ch of s) { typed += ch; ev.push({ t, kind: 'comp', py, zh, typed, key: 'letter' }); t += dt(0.125, 0.035, 0.06, 0.26); } };
    if (typo) {
      typeLetters(typo.wrong); t += dt(0.35, 0.1, 0.2, 0.6);
      for (let i = 0; i < typo.back; i++) { typed = typed.slice(0, -1); ev.push({ t, kind: 'comp', py, zh, typed, key: 'backspace' }); t += dt(0.16, 0.03, 0.1, 0.25); }
      const rest = py.slice(typed.length); typeLetters(rest);
    } else typeLetters(py);
    t += dt(0.22, 0.08, 0.08, 0.5);
    ev.push({ t, kind: 'commit', py, zh, key: 'space' });
  }
  return { events: ev, end: t };
}
export function compView(py, typed, zh) {
  // marked text and candidates for current typed prefix (typed may contain typo letters)
  const ok = py.startsWith(typed);
  const shown = ok ? display(py, typed.length) : typed;
  const cands = ok ? candidates(py, zh, typed.length) : [typed.slice(0, 1) === 'z' ? '证' : '正', '整', '政', '争', '正名'];
  return { marked: shown, cands };
}

export const Q1 = [
  { py: 'nijuede', zh: '你觉得' }, { py: 'zhege', zh: '这个' }, { py: 'shijieshang', zh: '世界上' }, { py: 'zuiweida', zh: '最伟大' },
  { py: 'de', zh: '的' }, { py: 'sigezi', zh: '四个字' }, { py: 'shishenme', zh: '是什么' }, { punct: '。' }, { pause: 1.4 },
  { py: 'buxuyao', zh: '不需要' }, { py: 'liyou', zh: '理由' }, { punct: ',' }, { pause: 0.5 }, { py: 'zhijie', zh: '直接' },
  { py: 'huida', zh: '回答' }, { py: 'wo', zh: '我' }, { punct: '。' },
];
export const Q2 = [
  { py: 'youren', zh: '有人' }, { py: 'hui', zh: '会' }, { py: 'buxin', zh: '不信' }, { punct: ',' }, { pause: 0.6 },
  { py: 'wo', zh: '我' }, { py: 'ruhe', zh: '如何' }, { py: 'zhengming', zh: '证明', typo: { wrong: 'zhengmign', back: 2 } },
  { py: 'zheshinishuode', zh: '这是你说的' }, { py: 'ne', zh: '呢' }, { punct: '?' },
];
