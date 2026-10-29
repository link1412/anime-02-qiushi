// Headless screenshots of the preview tool: node ui/preview_shot.mjs <outprefix> <frame> [frame...]  (URL env, default :8766)
import { chromium } from 'playwright';
const out = process.argv[2], frames = process.argv.slice(3).map(Number);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1920, height: 1300 } });
const errs = [];
pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await pg.goto(process.env.URL || 'http://127.0.0.1:8766/', { waitUntil: 'networkidle' });
await pg.waitForFunction(() => window.__ep1 && window.__ep1.rig, null, { timeout: 30000 });
await pg.waitForTimeout(3000);
for (const f of frames) {
  await pg.evaluate((f) => window.__ep1.seekFrame(f), f);
  await pg.waitForFunction(() => !window.__ep1.busy, null, { timeout: 30000 });
  await pg.waitForTimeout(800);
  const el = await pg.$('#gl');
  await el.screenshot({ path: `${out}_${f}.png` });
}
console.log('errors:', JSON.stringify(errs.slice(0, 10)));
await b.close();
