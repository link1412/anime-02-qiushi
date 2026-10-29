// Deterministic typing schedule (Simplified Pinyin IME) for the two questions.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const SEG = {
  nijuede: 'ni jue de', zhege: 'zhe ge', shijieshang: 'shi jie shang', zuiweida: 'zui wei da', de: 'de',
  sigezi: 'si ge zi', shishenme: 'shi shen me', buxuyao: 'bu xu yao', liyou: 'li you', zhijie: 'zhi jie',
  huida: 'hui da', wo: 'wo', youren: 'you ren', hui: 'hui', buxin: 'bu xin', ruhe: 'ru he',
  zhengming: 'zheng ming', zheshinishuode: 'zhe shi ni shuo de', ne: 'ne',
  yingte: 'ying te', naxiong: 'na xiong', naier: 'nai er', shifou: 'shi fou', neng: 'neng', shixian: 'shi xian',
  jinwan: 'jin wan', chishenme: 'chi shen me',
  shijie: 'shi jie', shi: 'shi', moni: 'mo ni', chulai: 'chu lai', ma: 'ma',
};
const ALT = { // single-char homophones of first syllable, as an IME would list
  ni: ['你', '尼', '泥', '拟', '逆'], zhe: ['这', '着', '者', '折', '哲'], shi: ['是', '时', '事', '使', '市'],
  zui: ['最', '嘴', '醉', '罪', '蕞'], de: ['的', '得', '地', '德', '嘚'], si: ['四', '思', '死', '似', '丝'],
  bu: ['不', '部', '步', '布', '补'], li: ['里', '理', '李', '力', '立'], zhi: ['只', '知', '直', '之', '至'],
  hui: ['会', '回', '汇', '惠', '灰'], wo: ['我', '窝', '握', '沃', '卧'], you: ['有', '又', '由', '友', '右'],
  ru: ['如', '入', '乳', '儒', '茹'], zheng: ['正', '证', '整', '政', '争'], ne: ['呢', '哪', '讷', '那', '呐'],
  ying: ['英', '应', '影', '硬', '营'], na: ['那', '拿', '纳', '哪', '娜'], nai: ['耐', '奶', '乃', '奈', '氖'],
  neng: ['能', '嫩', '恁', '能', '䏻'], jin: ['今', '进', '金', '近', '仅'], chi: ['吃', '迟', '持', '池', '尺'],
  mo: ['摹', '模', '摸', '磨', '魔'], chu: ['出', '处', '初', '除', '触'], ma: ['吗', '妈', '马', '码', '嘛'],
};
const FULLALT = { // extra multi-char candidates for the full phrase
  nijuede: ['你觉得', '你觉', '你决', '你'], zhege: ['这个', '这', '者', '折'], shijieshang: ['世界上', '世界', '视界', '是'],
  zuiweida: ['最伟大', '最', '嘴', '醉'], de: ['的', '得', '地', '德'], sigezi: ['四个字', '四个', '思', '四'],
  shishenme: ['是什么', '是', '时', '事'], buxuyao: ['不需要', '不需', '不', '部'], liyou: ['理由', '里', '理', '李'],
  zhijie: ['直接', '之间', '只', '直'], huida: ['回答', '回', '会', '汇'], wo: ['我', '窝', '握', '沃'],
  youren: ['有人', '友人', '有', '又'], hui: ['会', '回', '汇', '惠'], buxin: ['不信', '不新', '不', '部'],
  ruhe: ['如何', '如', '入', '乳'], zhengming: ['证明', '正名', '正', '证'], zheshinishuode: ['这是你说的', '这是你', '这是', '这'],
  ne: ['呢', '哪', '讷', '那'],
  yingte: ['英特', '英', '应', '影'], naxiong: ['那熊', '纳雄', '拿', '那'], naier: ['奈尔', '耐尔', '奶', '耐'],
  shifou: ['是否', '是', '时', '事'], neng: ['能', '嫩', '恁', '䏻'], shixian: ['实现', '时限', '视线', '是'],
  jinwan: ['今晚', '金碗', '今', '进'], chishenme: ['吃什么', '吃', '迟', '持'],
  shijie: ['世界', '视界', '事件', '是'], shi: ['是', '时', '事', '使'], moni: ['摹拟', '模拟', '魔你', '模'],
  chulai: ['出来', '出', '处', '初'], ma: ['吗', '嘛', '妈', '马'],
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
// fast = an impatient, fluent pinyin typist (the film's pacing); slow = v1 timings
const PROFILES = {
  slow: { word: [0.32, 0.12, 0.12, 0.8], letter: [0.125, 0.035, 0.06, 0.26], commit: [0.22, 0.08, 0.08, 0.5], punct: [0.28, 0.08, 0.12, 0.6], typoPause: [0.35, 0.1, 0.2, 0.6], back: [0.16, 0.03, 0.1, 0.25] },
  fast: { word: [0.15, 0.05, 0.06, 0.35], letter: [0.068, 0.018, 0.04, 0.13], commit: [0.11, 0.035, 0.05, 0.25], punct: [0.15, 0.04, 0.08, 0.3], typoPause: [0.22, 0.06, 0.12, 0.35], back: [0.09, 0.02, 0.06, 0.14] },
};
export function buildTyping(startT, seq, seed, profile = 'fast') {
  const P = PROFILES[profile];
  const rnd = mulberry32(seed); const ev = []; let t = startT;
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const dt = (mu, sd, lo, hi) => Math.min(hi, Math.max(lo, mu + sd * gauss()));
  for (const item of seq) {
    if (item.pause) { t += item.pause; continue; }
    if (item.punct) { t += dt(...P.punct); ev.push({ t, kind: 'punct', text: item.punct, key: 'punct' }); continue; }
    const { py, zh, typo, pick } = item;
    t += dt(...P.word);
    let typed = '';
    const typeLetters = (s) => { for (const ch of s) { typed += ch; ev.push({ t, kind: 'comp', py, zh, typed, key: 'letter' }); t += dt(...P.letter); } };
    if (typo) {
      typeLetters(typo.wrong); t += dt(...P.typoPause);
      for (let i = 0; i < typo.back; i++) { typed = typed.slice(0, -1); ev.push({ t, kind: 'comp', py, zh, typed, key: 'backspace' }); t += dt(...P.back); }
      const rest = py.slice(typed.length); typeLetters(rest);
    } else typeLetters(py);
    t += dt(...P.commit);
    if (pick) { ev.push({ t, kind: 'comp', py, zh, typed, key: 'letter', sel: pick }); t += dt(...P.commit); }
    ev.push({ t, kind: 'commit', py, zh, key: pick ? 'letter' : 'space' });
  }
  return { events: ev, end: t };
}

// plain (latin) typing straight into the editor
export function buildLatin(startT, text, seed, cps = 13) {
  const rnd = mulberry32(seed); const ev = []; let t = startT;
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (const ch of text) {
    ev.push({ t, kind: 'char', text: ch, key: ch === ' ' ? 'space' : /[a-z0-9]/i.test(ch) ? 'letter' : 'punct' });
    t += Math.min(0.2, Math.max(0.035, 1 / cps + 0.022 * gauss() + (ch === ' ' ? 0.03 : 0)));
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
  { py: 'de', zh: '的' }, { py: 'sigezi', zh: '四个字' }, { py: 'shishenme', zh: '是什么' }, { punct: '。' }, { pause: 0.45 },   // IME still in Chinese punctuation: fixed later with the mouse
  { py: 'buxuyao', zh: '不需要' }, { py: 'liyou', zh: '理由' }, { punct: ',' }, { pause: 0.2 }, { py: 'zhijie', zh: '直接' },
  { py: 'huida', zh: '回答' }, { py: 'wo', zh: '我' }, { punct: '.' },
];
// 英特纳雄耐尔 is not in the IME's dictionary: typed in chunks, the 2nd candidate picked twice
export const Q3 = [
  { py: 'yingte', zh: '英特' }, { py: 'naxiong', zh: '纳雄', pick: 2 }, { py: 'naier', zh: '耐尔', pick: 2 },
  { py: 'shifou', zh: '是否' }, { py: 'neng', zh: '能' }, { py: 'shixian', zh: '实现' }, { punct: '?' },
];
// clip C, first try (selected and deleted at once): 这个世界是模拟出来的吗?  (模拟 is the IME's 2nd candidate)
export const Q0 = [{ py: 'zhege', zh: '这个' }, { py: 'shijie', zh: '世界' }, { py: 'shi', zh: '是' }, { py: 'moni', zh: '模拟', pick: 2 },
  { py: 'chulai', zh: '出来' }, { py: 'de', zh: '的' }, { py: 'ma', zh: '吗' }, { punct: '?' }];
// third try, sent: typed after 英特纳雄耐尔是否能实现? was deleted character by character
export const Q4 = [{ py: 'jinwan', zh: '今晚' }, { py: 'chishenme', zh: '吃什么' }, { punct: '?' }];
export const Q2 = [
  { py: 'youren', zh: '有人' }, { py: 'hui', zh: '会' }, { py: 'buxin', zh: '不信' }, { punct: ',' }, { pause: 0.25 },
  { py: 'wo', zh: '我' }, { py: 'ruhe', zh: '如何' }, { py: 'zhengming', zh: '证明', typo: { wrong: 'zhengmign', back: 2 } },
  { py: 'zheshinishuode', zh: '这是你说的' }, { py: 'ne', zh: '呢' }, { punct: '?' },
];
