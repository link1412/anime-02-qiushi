// Menubar assets for every frame of the film: clock strings ("10月30日 06:12:40") and battery
// level images, rendered with the system font on a transparent background.
// Input: build/menubar_needs.json (written by render/assets.py). Output: build/clock/, build/battery/.
import { chromium } from 'playwright';
import fs from 'fs';

const ROOT = '/path/to/ep1';
const need = JSON.parse(fs.readFileSync(`${ROOT}/build/menubar_needs.json`));
const CLK = `${ROOT}/build/clock`, BAT = `${ROOT}/build/battery`;
fs.mkdirSync(CLK, { recursive: true }); fs.mkdirSync(BAT, { recursive: true });
const fontPx = 14.0;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 220, height: 24 }, deviceScaleFactor: 1 });
const old = fs.existsSync(`${CLK}/meta.json`) ? JSON.parse(fs.readFileSync(`${CLK}/meta.json`)) : { meta: {} };
const meta = {};
for (const str of need.clocks) {
  const name = str.replace(/[^0-9]/g, '') + '.png';
  await page.setContent(`<html><body style="margin:0;background:transparent"><span id=t style="font:500 ${fontPx}px -apple-system,'PingFang SC';color:rgba(0,0,0,.86);letter-spacing:0;position:absolute;right:4px;top:4px;white-space:nowrap;font-variant-numeric:tabular-nums">${str}</span></body></html>`);
  const box = await page.$eval('#t', e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  await page.screenshot({ path: `${CLK}/${name}`, omitBackground: true });
  meta[str] = { file: name, box };
}
fs.writeFileSync(`${CLK}/meta.json`, JSON.stringify({ t0: old.t0 ?? null, meta }, null, 1));

await page.setViewportSize({ width: 74, height: 24 });
for (const n of need.batteries) {
  const low = n <= 10;
  const w = Math.max(1.5, 18.5 * n / 100);
  await page.setContent(`<html><body style="margin:0;background:transparent">
  <div style="position:absolute;right:6px;top:0;height:24px;display:flex;align-items:center;gap:5px;font:500 12.6px -apple-system,'PingFang SC';color:rgba(0,0,0,.86);font-variant-numeric:tabular-nums">
    <span>${n}%</span>
    <svg width="26" height="13" viewBox="0 0 26 13"><rect x="0.6" y="0.6" width="22.3" height="11.8" rx="3.4" fill="none" stroke="rgba(0,0,0,.42)" stroke-width="1.1"/>
      <rect x="2.4" y="2.4" width="${w}" height="8.2" rx="1.8" fill="${low ? '#e5463f' : 'rgba(0,0,0,.86)'}"/>
      <path d="M24.3 4.4 q1.4 0.3 1.4 2.1 q0 1.8 -1.4 2.1z" fill="rgba(0,0,0,.42)"/></svg>
  </div></body></html>`);
  await page.screenshot({ path: `${BAT}/${n}.png`, omitBackground: true });
}
console.log('clocks', need.clocks.length, 'batteries', need.batteries.join(','));
await browser.close();
