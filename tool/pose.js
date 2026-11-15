// Port of render/camera.py (keep in sync; tool/test_pose.py compares both).
// Works in the browser and in node (ES module, no DOM).

const LOW_STEADY = 0.18;

export function makeTval(anchors) {
  const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*([0-9.]+)\s*$/;
  return function tval(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const m = re.exec(v);
    if (!m) throw new Error(`bad time expression ${JSON.stringify(v)}`);
    if (!(m[1] in anchors)) throw new Error(`unknown anchor ${m[1]}`);
    const base = anchors[m[1]], off = parseFloat(m[3]);
    return m[2] === '+' ? base + off : base - off;
  };
}

// split a time back into the same anchor form it had (keeps 'E1+x' style when editing)
export function retime(oldT, newT, anchors) {
  if (typeof oldT === 'string') {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(oldT);
    if (m && m[1] in anchors) {
      const off = +(newT - anchors[m[1]]).toFixed(3);
      return off >= 0 ? `${m[1]}+${off}` : `${m[1]}-${-off}`;
    }
  }
  return +newT.toFixed(3);
}

function noiseFn(p) {
  const n = p.f.length, TWO_PI = 2 * Math.PI;
  return (t) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += p.a[i] * Math.sin(TWO_PI * p.f[i] * t + p.p[i]);
    return s;
  };
}

function steadiness(t, dist) {
  let s = 1.0;
  if (dist < 80) s = dist > 18 ? LOW_STEADY + 0.82 * (dist - 18) / 62 : LOW_STEADY;
  return Math.max(0.15, s);
}

function searchsortedLeft(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1; while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

const DEG = Math.PI / 180;

export class Clip {
  constructor(c, f0, ctx) {
    const { tval, noiseBySeed, consts } = ctx;
    this.raw = c; this.id = c.id; this.dur = tval(c.dur);
    this.FPS = consts.FPS; this.PP = consts.PP; this.consts = consts;
    this.nf = Math.round(this.dur * this.FPS);
    this.f0 = f0; this.t0 = f0 / this.FPS;
    const keys = c.keys.map((k, i) => ({ k, i, t: tval(k.t) })).sort((a, b) => a.t - b.t);
    this.keyOrder = keys.map(o => o.i);            // sorted -> raw index
    this.KT = keys.map(o => o.t);
    this.KV = keys.map(o => [o.k.x, o.k.y, o.k.d, o.k.yaw, o.k.pitch, o.k.roll]);
    this.FLOW = keys.map(o => !!o.k.flow);
    this.macro = (c.macro || []).map(([a, b]) => [tval(a), tval(b)]);
    this.stop = tval(c.stop_tap ?? null);
    const nz = noiseBySeed[c.seed ?? 0];
    if (!nz) throw new Error(`no noise params for seed ${c.seed}`);
    this.N = {}; for (const k in nz) this.N[k] = noiseFn(nz[k]);
    const af = c.af || {};
    this.afStart = af.start ?? 2000;
    this.afIntro = af.intro || null;
    this.hunts = (af.hunts || []).map(h => [tval(h.t), h.pts]);
  }

  moveSpan(i) {
    let a = i, b = i + 1;
    while (a > 0 && this.FLOW[a]) a--;
    while (b < this.KT.length - 1 && this.FLOW[b]) b++;
    return [a, b];
  }

  flowInterp(t, a, b) {   // = camera.py flow_interp
    const KT = this.KT;
    const P = this.KV.map(v => { const w = v.slice(); w[2] = Math.log(w[2]); return w; });
    const u = Math.min(Math.max((t - KT[a]) / (KT[b] - KT[a]), 0), 1);
    const s = KT[a] + (KT[b] - KT[a]) * u * u * (3 - 2 * u);
    let j = searchsortedLeft(KT, s) - 1; j = Math.min(Math.max(j, a), b - 1);
    const h = KT[j + 1] - KT[j];
    const tan = (k) => { const lo = Math.max(k - 1, a), hi = Math.min(k + 1, b); return P[hi].map((v, q) => (v - P[lo][q]) / (KT[hi] - KT[lo])); };
    const x = (s - KT[j]) / h;
    const h00 = 2 * x ** 3 - 3 * x ** 2 + 1, h10 = x ** 3 - 2 * x ** 2 + x, h01 = -2 * x ** 3 + 3 * x ** 2, h11 = x ** 3 - x ** 2;
    const m0 = tan(j), m1 = tan(j + 1);
    const v = P[j].map((p0, q) => h00 * p0 + h10 * h * m0[q] + h01 * P[j + 1][q] + h11 * h * m1[q]);
    v[2] = Math.exp(v[2]);
    return v;
  }

  smoothInterp(t) {
    const KT = this.KT, KV = this.KV, n = KT.length;
    if (n === 1) return KV[0].slice();
    let i = searchsortedLeft(KT, t) - 1;
    i = Math.min(Math.max(i, 0), n - 2);
    const [ma, mb] = this.moveSpan(i);
    if (mb - ma > 1) return this.flowInterp(t, ma, mb);
    const t0 = KT[i], t1 = KT[i + 1];
    let a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    a = Math.min(Math.max(a, 0), 1);
    const e = a * a * (3 - 2 * a);
    const p0 = KV[Math.max(i - 1, 0)], p1 = KV[i], p2 = KV[i + 1], p3 = KV[Math.min(i + 2, n - 1)];
    const out = new Array(6);
    for (let j = 0; j < 6; j++) {
      const cr = 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * e + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * e * e + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * e ** 3);
      const lin = p1[j] + (p2[j] - p1[j]) * e;
      out[j] = 0.35 * cr + 0.65 * lin;
    }
    return out;
  }

  isMacro(t) { return this.macro.some(([a, b]) => a <= t && t < b); }

  lensJump(t) {
    let dx = 0, dy = 0;
    for (const [a, b] of this.macro) {
      const L = this.consts;
      for (const [ts, sx, sy] of [[a, L.LENS_DX, L.LENS_DY], [b, -L.LENS_DX, -L.LENS_DY]]) {
        if (t >= ts) {
          const u = t - ts; let r = Math.min(1, u / L.LENS_XFADE); r = r * r * (3 - 2 * r);
          const k = r * Math.exp(-u / 0.55); dx += sx * k; dy += sy * k;
        }
      }
    }
    return [dx, dy];
  }

  tapJolt(t) {
    if (this.stop === null || t < this.stop) return [0, 0, 0];
    const u = t - this.stop;
    const k = Math.exp(-u / 0.07) * Math.sin(u * 2 * Math.PI * 6);
    return [0.9 * k, 2.4 * k, 1.5 * k];
  }

  pose(t) {
    const N = this.N, PP = this.PP;
    let [tx, ty, d, yaw, pit, rol] = this.smoothInterp(t);
    const s = steadiness(t, d);
    let txm = tx * PP + 0.9 * s * N.x(t);
    let tym = ty * PP + 0.9 * s * N.y(t);
    d = d + 2.0 * s * N.z(t) * (d / 250);
    yaw = yaw + 0.28 * s * N.yaw(t) + 0.010 * N.tyaw(t);
    pit = pit + 0.28 * s * N.pit(t) + 0.010 * N.tpit(t);
    rol = rol + 0.35 * s * N.rol(t);
    const [jx, jy] = this.lensJump(t); txm += jx; tym += jy;
    const [jp, jz, jyy] = this.tapJolt(t); pit += jp; d += jz; tym += jyy;
    const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
    const cp = Math.cos(pit * DEG), sp = Math.sin(pit * DEG);
    const cr = Math.cos(rol * DEG), sr = Math.sin(rol * DEG);
    // M = Ry @ Rx @ Rz
    const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
    const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
    const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
    const M = mm(mm(Ry, Rx), Rz);
    const right = [M[0][0], M[1][0], M[2][0]], down = [M[0][1], M[1][1], M[2][1]], fwd = [M[0][2], M[1][2], M[2][2]];
    const C = [txm - d * fwd[0], tym - d * fwd[1], 0 - d * fwd[2]];
    const macro = this.isMacro(t);
    return { C, right, down, fwd, fx: macro ? this.consts.FX_MACRO : this.consts.FX_MAIN, macro, dist: d,
             target: [txm / PP, tym / PP], raw: [tx, ty, d, yaw, pit, rol] };
  }

  focus(n) {
    const FPS = this.FPS, sf = new Float64Array(n);
    let st = this.afStart;
    if (typeof st === 'string' && st.startsWith('x')) st = this.pose(0).dist * parseFloat(st.slice(1));
    st = +st;
    let cur = st;
    const k = 1 - Math.exp(-(1 / FPS) / 0.12);
    for (let i = 0; i < n; i++) {
      const t = i / FPS;
      const tru = this.pose(t).dist;
      cur += (tru - cur) * k;
      let err = 0;
      for (const [t0, pts] of this.hunts) {
        const u = t - t0;
        if (u >= 0 && u <= pts[pts.length - 1][0]) err += interp(u, pts.map(q => q[0]), pts.map(q => q[1]));
      }
      sf[i] = t > 0 ? cur * (1 + err) : st;
      if (this.afIntro && t < this.afIntro[2]) sf[i] = tru * (1 + this.afIntro[0] - this.afIntro[1] * t);
    }
    return sf;
  }
}

function mm(A, B) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0; for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
    R[i][j] = s;
  }
  return R;
}

export class Rig {
  constructor(sb, anchors, noiseBySeed, consts) {
    const tval = makeTval(anchors);
    this.tval = tval; this.FPS = consts.FPS;
    this.clips = []; let f = 0;
    for (const c of sb.clips) { const cl = new Clip(c, f, { tval, noiseBySeed, consts }); this.clips.push(cl); f += cl.nf; }
    this.nframes = f;
    this.duration = f / this.FPS;
    this._focus = null;
  }
  locate(f) {
    for (let i = 0; i < this.clips.length; i++) {
      const c = this.clips[i];
      if (f < c.f0 + c.nf) return { clip: c, index: i, t: (f - c.f0) / this.FPS, lf: f - c.f0 };
    }
    const i = this.clips.length - 1, c = this.clips[i];
    return { clip: c, index: i, t: (f - c.f0) / this.FPS, lf: f - c.f0 };
  }
  get focus() {
    if (!this._focus) {
      const parts = this.clips.map((c, i) => {
        const a = c.focus(c.nf + 2);
        return i === this.clips.length - 1 ? a : a.subarray(0, c.nf);
      });
      const n = parts.reduce((s, a) => s + a.length, 0), out = new Float64Array(n);
      let o = 0; for (const a of parts) { out.set(a, o); o += a.length; }
      this._focus = out;
    }
    return this._focus;
  }
}
