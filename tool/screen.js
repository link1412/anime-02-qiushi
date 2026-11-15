// What the MacBook panel shows for a film frame: window texture (real UI frame, or the last
// real frame + placeholder cards for clips not captured yet) and the menubar strip (clock, battery).

export function valueAt(v, t) {
  if (Array.isArray(v)) {
    if (!v.length) return 0;
    if (t <= v[0][0]) return v[0][1];
    for (let i = 1; i < v.length; i++) {
      if (t <= v[i][0]) { const [t0, a] = v[i - 1], [t1, b] = v[i]; return a + (b - a) * (t - t0) / (t1 - t0); }
    }
    return v[v.length - 1][1];
  }
  return +v || 0;
}

const pad = (n) => String(n).padStart(2, '0');

export class Screen {
  constructor(state, renderer) {
    this.S = state; this.r = renderer; this.G = state.geom;
    this.cache = new Map();          // ui name -> {p: Promise, bmp}
    this.clockImgs = new Map();
    this.winKey = null; this.barKey = null;
    this.markers = true;
    const G = this.G;
    this.winCanvas = document.createElement('canvas'); this.winCanvas.width = G.WIN_W; this.winCanvas.height = G.WIN_H;
    this.barCanvas = document.createElement('canvas'); this.barCanvas.width = G.BAR[2]; this.barCanvas.height = G.BAR[3];
  }

  async init() {
    this.batteryImgs = new Map();
    await Promise.all((this.S.battery_imgs || []).map(async (n) => {
      const r = await fetch(`/build/battery/${n}.png`);
      this.batteryImgs.set(n, { img: await createImageBitmap(await r.blob()) });
    }));
    // mouse pointer sprites (real NSCursor artwork, 16 px/pt; panel is 1 px/pt = native 3024x1890, see compose.PX_PER_PT)
    this.cursorImgs = new Map();
    await Promise.all(Object.keys(this.S.cursorMeta || {}).map(async (n) => {
      const r = await fetch(`/ref/cursor/${n}.png`);
      this.cursorImgs.set(n, await createImageBitmap(await r.blob()));
    }));
    const res = await fetch(this.S.desk);
    this.desk = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    this.r.upload('desk', this.desk);
    const G = this.G;
    const bc = this.barCanvas.getContext('2d');
    bc.drawImage(this.desk, G.BAR[0], G.BAR[1] + G.NOTCH, G.BAR[2], G.BAR[3], 0, 0, G.BAR[2], G.BAR[3]);
    this.barBase = bc.getImageData(0, 0, G.BAR[2], G.BAR[3]);
    const px = this.barBase.data, i = (12 * G.BAR[2] + 150) * 4;
    this.barTint = `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`;
  }

  cursorAt(f) {
    const c = this.S.ui.cursor;
    if (!c) return null;
    return c[Math.min(Math.max(f - this.S.ui.startFrame, 0), c.length - 1)] || null;
  }

  _drawCursor(cur) {
    const m = this.S.cursorMeta[cur[2]], im = this.cursorImgs.get(cur[2]);
    if (!m || !im) return;
    const PT = 1, z = cur[3] || 1, k = PT * z / m.scale, s = this.S.ui.cssScale || 1.5;   // z: macOS shake-to-locate size
    const ctx = this.winCanvas.getContext('2d');
    ctx.drawImage(im, cur[0] * s - m.hx * PT * z, cur[1] * s - m.hy * PT * z, im.width * k, im.height * k);
  }

  uiName(f) {
    const fr = this.S.ui.frames;
    return fr[Math.min(Math.max(f - this.S.ui.startFrame, 0), fr.length - 1)];
  }

  load(name) {
    let e = this.cache.get(name);
    if (e) { this.cache.delete(name); this.cache.set(name, e); return e; }
    e = { bmp: null };
    e.p = fetch(`/build/ui_frames/${name}?v=${this.S.ui.version || 0}`).then(r => r.blob())
      .then(b => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      .then(bmp => { e.bmp = bmp; return bmp; });
    this.cache.set(name, e);
    while (this.cache.size > 48) {
      const [k, old] = this.cache.entries().next().value;
      if (old.bmp) old.bmp.close();
      this.cache.delete(k);
    }
    return e;
  }

  clockImg(file) {
    let e = this.clockImgs.get(file);
    if (!e) {
      e = { img: null };
      e.p = fetch(`/build/clock/${file}`).then(r => r.blob()).then(b => createImageBitmap(b)).then(i => (e.img = i));
      this.clockImgs.set(file, e);
    }
    return e;
  }

  // describe the panel for (clip, local time); pure data, used as a change key
  describe(rig, loc) {
    const c = loc.clip.raw, u = loc.t, A = rig.clips[0];
    const scr = c.screen || { kind: 'mock', cards: [] };
    const d = { win: null, bar: null };
    if (scr.kind === 'ui' || scr.kind === 'ui_v1') {
      const f = loc.clip.f0 + loc.lf;
      d.win = { ui: this.uiName(f), cur: this.cursorAt(f) };     // captured UI + pointer, indexed by film frame
    } else {
      const cards = [];
      for (const k of scr.cards || []) {
        if (u < k.t || u >= (k.until ?? 1e9)) continue;
        let text = k.text || '';
        if (k.type === 'typing') {
          const a = Math.min(Math.max((u - k.t0) / (k.t1 - k.t0), 0), 1);
          const chars = Array.from(text);
          text = chars.slice(0, Math.floor(a * chars.length)).join('') + (Math.floor(u * 2) % 2 === 0 ? '|' : ' ');
        }
        if (k.count) {
          const end = Math.min(k.until ?? loc.clip.dur, loc.clip.dur);
          const a = Math.min(Math.max((u - k.t) / Math.max(end - k.t, 1e-3), 0), 1);
          const n = Math.round(k.count[0] + (k.count[1] - k.count[0]) * a);
          text = text.replace(/\{n\+(\d+)\}/g, (_, m) => n + +m).replace(/\{n\}/g, n);
        }
        cards.push({ text, x: k.x, y: k.y + Math.round((k.scroll || 0) * (u - k.t)), w: k.w || 600, size: k.size || 21,
                     color: k.color || '#f8f8f2', bg: k.bg || '#21222c' });
      }
      d.win = { ui: this.uiName(A.f0 + A.nf - 1 - A.f0), cards, markers: this.markers };
    }
    // menubar
    // same rules as render/compose.py clip_clock_seconds()
    const hms = (v) => { const [h, m, s] = String(v).split(':'); return +h * 3600 + +m * 60 + parseFloat(s); };
    let secs;
    const ck = c.clock || '00:00:00';
    if (typeof ck === 'object') secs = ck.kind === 'ui_v1' ? this.S.clock.t0 + u : hms(ck.at) + (u - this.tval(ck.t ?? 0));
    else secs = hms(ck) + u;
    const tot = Math.floor(secs);
    const clock = `10月30日 ${pad(Math.floor(tot / 3600) % 24)}:${pad(Math.floor(tot / 60) % 60)}:${pad(tot % 60)}`;
    const clockFile = this.S.clock.meta[clock]?.file || null;
    d.bar = { clock, clockFile, battery: Math.round(valueAt(c.battery ?? 89, u)), charging: !!c.charging };
    return d;
  }

  // make textures match the description; returns false if a needed image isn't decoded yet
  async apply(d, wait) {
    let ok = true;
    const wk = JSON.stringify(d.win);
    if (wk !== this.winKey) {
      const e = this.load(d.win.ui);
      if (!e.bmp) { if (wait) await e.p; else ok = false; }
      if (e.bmp) {
        if (d.win.cards) this._drawMock(e.bmp, d.win);
        else if (d.win.cur) { this.winCanvas.getContext('2d').drawImage(e.bmp, 0, 0); this._drawCursor(d.win.cur); this.r.upload('win', this.winCanvas); }
        else this.r.upload('win', e.bmp);
        this.winKey = wk;
      }
    }
    const bk = JSON.stringify(d.bar);
    if (bk !== this.barKey) {
      let img = null;
      if (d.bar.clockFile) {
        const e = this.clockImg(d.bar.clockFile);
        if (!e.img && wait) await e.p;
        img = e.img;
      }
      if (!d.bar.clockFile || img) { this._drawBar(d.bar, img); this.barKey = bk; }
      else ok = false;
    }
    return ok;
  }

  prefetch(names) { for (const n of names) this.load(n); }

  _drawMock(bmp, w) {
    const G = this.G, ctx = this.winCanvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const ox = G.WIN_X, oy = G.WIN_Y + G.NOTCH;
    for (const k of w.cards) {
      const fs = k.size, lh = Math.round(fs * 1.55), padd = Math.round(fs * 0.8);
      const lines = k.text.split('\n');
      const h = lines.length * lh + padd * 2;
      const x = Math.round(k.x - ox - k.w / 2), y = Math.round(k.y - oy - h / 2);
      ctx.save();
      ctx.fillStyle = k.bg; ctx.strokeStyle = '#44475a'; ctx.lineWidth = 1.5;
      rr(ctx, x, y, k.w, h, 10); ctx.fill(); ctx.stroke();
      if (w.markers) { ctx.setLineDash([10, 7]); ctx.strokeStyle = '#ffb86c'; ctx.lineWidth = 2; rr(ctx, x - 4, y - 4, k.w + 8, h + 8, 13); ctx.stroke(); }
      ctx.fillStyle = k.color;
      ctx.font = `500 ${fs}px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
      ctx.textBaseline = 'middle';
      lines.forEach((ln, i) => ctx.fillText(ln, x + padd, y + padd + lh * (i + 0.5)));
      ctx.restore();
    }
    this.r.upload('win', this.winCanvas);
  }

  _drawBar(b, clockImg) {
    const G = this.G, ctx = this.barCanvas.getContext('2d');
    ctx.putImageData(this.barBase, 0, 0);
    const cx = G.CLOCK_X0 - G.BAR[0];
    if (clockImg) ctx.drawImage(clockImg, cx, 0);
    else {
      ctx.font = '500 14px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.86)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(b.clock, cx + 216, 12.5);
    }
    if ((b.battery !== 89 || !b.charging) && this.batteryImgs.get(b.battery)?.img) {
      // erase the captured "89% [charging]" with the menubar tint (row by row), draw the rendered level
      const x0 = 2768 - G.BAR[0], x1 = 2842 - G.BAR[0];
      const src = ctx.getImageData(x0 - 14, 0, 12, G.BAR[3]).data;
      for (let y = 1; y < 23; y++) {
        let r = 0, g = 0, bl = 0;
        for (let x = 0; x < 12; x++) { const i = (y * 12 + x) * 4; r += src[i]; g += src[i + 1]; bl += src[i + 2]; }
        ctx.fillStyle = `rgb(${r / 12},${g / 12},${bl / 12})`; ctx.fillRect(x0, y, x1 - x0, 1);
      }
      const im = this.batteryImgs.get(b.battery).img;
      ctx.drawImage(im, x1 - im.width, 0);
    } else if (b.battery !== 89 || !b.charging) {
      ctx.fillStyle = this.barTint; ctx.fillRect(168, 2, 70, 20);
      ctx.font = '500 13px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.86)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${b.battery}%`, 202, 12.5);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
      rr(ctx, 206.5, 6.5, 23, 11, 3); ctx.stroke();
      ctx.fillStyle = b.battery <= 10 ? '#e0443e' : 'rgba(0,0,0,0.86)';
      rr(ctx, 208.5, 8.5, Math.max(1.5, 19 * b.battery / 100), 7, 1.5); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(230.5, 10, 1.5, 4);
    }
    this.r.upload('bar', this.barCanvas);
  }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
