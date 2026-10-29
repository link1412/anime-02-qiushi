// Port of render/lighter.py state() + projection, for the WebGL preview.
// Keep in sync with the Python version (same constants, same deterministic noise).

const FLAME_W = 7.0, FLAME_H = 22.0;

function frac(x) { return x - Math.floor(x); }
export function n1(t, seed, freqs) {
  let v = 0, tot = 0;
  freqs.forEach((f, i) => {
    const ph = frac(Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) * 2 * Math.PI;
    v += Math.sin(2 * Math.PI * f * t + ph) / (i + 1); tot += 1 / (i + 1);
  });
  return v / tot;
}
const sm = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };

export function lighterState(cfg, t, tval) {
  if (!cfg) return null;
  const ts = tval(cfg.strike), to = tval(cfg.out);
  const [d0, d1] = cfg.drag ? [tval(cfg.drag[0]), tval(cfg.drag[1])] : [null, null];
  const tex = cfg.exhale != null ? tval(cfg.exhale) : null;
  const P = cfg.pos || [50, 58, -460];
  const gain = cfg.gain ?? 1;
  const hand = [2.5 * n1(t, 1, [0.35, 0.8]), 2.0 * n1(t, 2, [0.3, 0.7]), 4.0 * n1(t, 3, [0.25])];
  const st = { flame: 0, pos: P.map((v, i) => v + hand[i]), h: FLAME_H, w: FLAME_W, lean: 0, ember: 0,
               emberPos: [P[0], P[1] - FLAME_H * 0.75, P[2] + 6], spark: 0, sparkPos: P };
  if (t >= ts && t < ts + 0.07) st.spark = (1 - (t - ts) / 0.07) * 40 * gain;
  if (t >= ts + 0.03 && t < to + 0.07) {
    const grow = sm((t - ts - 0.03) / 0.12);
    const die = t >= to ? 1 - sm((t - to) / 0.07) : 1;
    let flick = 1 + 0.10 * n1(t, 4, [6.3, 9.1, 13.7]) + 0.05 * n1(t, 5, [17.0, 23.0]);
    let h = FLAME_H * (0.55 + 0.45 * grow) * (1 + 0.12 * n1(t, 6, [4.1, 7.7, 11.3]));
    let lean = 0.10 * n1(t, 7, [1.3, 2.9]);
    if (d0 != null && t >= d0 && t < d1) {
      const k = sm((t - d0) / 0.25) * (1 - sm((t - d1 + 0.25) / 0.25));
      const gulp = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.2 * (t - d0));
      h *= 1 + k * (0.35 + 0.15 * gulp);
      lean += k * 0.25 * n1(t, 8, [5.0, 8.0]);
      flick *= 1 + k * 0.12 * n1(t, 9, [11.0, 19.0]);
    }
    Object.assign(st, { flame: grow * die * flick * gain, h, lean });
  }
  if (d0 != null && t >= d0) {
    let e = t < d1 ? 0.25 + 0.75 * sm((t - d0) / 0.5) : 0.25 + 0.75 * Math.exp(-(t - d1) / 0.6);
    if (tex != null && t >= tex) e *= 0.8;
    st.ember = e * (cfg.ember ?? 1) * (1 + 0.08 * n1(t, 10, [2.0, 3.7]));
  }
  if (st.flame <= 0 && st.ember <= 0 && st.spark <= 0) return null;
  return st;
}

// mirror image of a room point in the screen plane, projected into output px
function proj(p, X) {
  const v = [X[0] - p.C[0], X[1] - p.C[1], -X[2] - p.C[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = dot(v, p.fwd);
  return [960 + p.fx * dot(v, p.right) / z, 540 + p.fx * dot(v, p.down) / z, z];
}

// uniforms for renderer.js: flame ellipse in output px (+ CoC), ember disc, world positions
export function lighterUniforms(st, p, focus) {
  const off = { on: 0 };
  if (!st) return off;
  const mac = p.macro, fl = mac ? 2.22 : 6.86, Nf = mac ? 2.2 : 1.78, sw = mac ? 1.8 : 4.9;
  const A = (fl * fl / (Nf * Math.max(focus - fl, 1e-3))) / sw * 1920;
  const coc = (z) => A * Math.abs(z - focus) / Math.max(z, 1e-3);
  const [fu, fv, fz] = proj(p, st.pos);
  const [eu, ev, ez] = proj(p, st.emberPos);
  const s = p.fx / fz;
  return {
    on: 1,
    flame: [fu, fv, st.w * s, st.h * s], flameI: st.flame, lean: st.lean, flameCoc: coc(fz),
    ember: [eu, ev, 1.5 * p.fx / ez, coc(ez)], emberI: st.ember, spark: st.spark,
    flameWorld: [st.pos[0], st.pos[1] - st.h * 0.35, st.pos[2]],
    amb: 0.010 * st.flame + 0.0008 * st.ember,
  };
}
