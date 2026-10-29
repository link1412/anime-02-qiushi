// Render macOS menubar clock strings ("10月30日 00:29:06") with the system font, transparent bg.
import { chromium } from 'playwright';
import fs from 'fs';
const OUT = '/path/to/ep1/build/clock';
fs.mkdirSync(OUT, { recursive: true });
const tl = JSON.parse(fs.readFileSync('/path/to/ep1/build/timeline.json'));
const enterClock = 29 * 60 + 6.32; // 00:29:06.32 = first message created
const t0 = enterClock - tl.T_ENTER1;
const fontPx = +(process.env.FONT || 13.4);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 220, height: 24 }, deviceScaleFactor: 1 });
const strings = new Set(['10月30日 00:37:55']);
for (let s = Math.floor(t0) - 1; s <= Math.ceil(t0 + tl.T_END) + 1; s++) {
  const m = Math.floor(s / 60), sec = s % 60;
  strings.add(`10月30日 00:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
}
const meta = {};
for (const str of strings) {
  await page.setContent(`<html><body style="margin:0;background:transparent"><span id=t style="font:500 ${fontPx}px -apple-system,'PingFang SC';color:rgba(0,0,0,.86);letter-spacing:0;position:absolute;right:4px;top:4px;white-space:nowrap;font-variant-numeric:tabular-nums">${str}</span></body></html>`);
  const box = await page.$eval('#t', e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  const name = str.replace(/[^0-9]/g, '') + '.png';
  await page.screenshot({ path: `${OUT}/${name}`, omitBackground: true });
  meta[str] = { file: name, box };
}
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ t0, meta }, null, 1));
console.log('clock strings', strings.size, 't0', t0, meta['10月30日 00:37:55']);
await browser.close();
