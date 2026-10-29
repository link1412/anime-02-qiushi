import { chromium } from '/path/to/ep1/ui/node_modules/playwright/index.mjs';
import { startMock } from '/path/to/ep1/ui/mock2.mjs';
const script = [];
for (let i = 0; i < 30; i++) script.push({ id: 'p' + i, startGate: false, blocks: [{ type: 'thinking', text: 'Batch ' + i + '. More sources.\n\n' },
  ...[0, 1, 2, 3, 4, 5].map(j => ({ type: 'tool', name: 'webfetch', input: { url: `https://zh.wikipedia.org/wiki/probe_${i}_${j}`, format: 'markdown' } }))] });
startMock({ port: 4320, script, logFile: '/tmp/film2/probe/mock.log' });
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1473, height: 926 }, deviceScaleFactor: 1, colorScheme: 'dark', httpCredentials: { username: 'opencode', password: 'film' }, locale: 'zh-CN' });
await ctx.addInitScript(() => localStorage.setItem('opencode-theme-id', 'dracula'));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4398/L1VzZXJzL3dhbmd5YW4vRGVza3RvcC9jbGF1ZGUtcC9lcDE/session', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const ed = page.locator('[contenteditable="true"]').first();
await ed.click(); await page.keyboard.insertText('probe'); await page.keyboard.press('Enter');
const st = () => page.evaluate(() => {
  const s = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean);
  return s ? { top: Math.round(s.scrollTop), sh: s.scrollHeight, ch: s.clientHeight, cls: s.className.toString().slice(0, 60), btns: btns.slice(-8) } : null;
});
await page.waitForTimeout(5000);
console.log('streaming', JSON.stringify(await st()));
await page.mouse.move(800, 400);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
for (let k = 0; k < 8; k++) { await page.waitForTimeout(500); console.log('after-up', k, JSON.stringify(await st())); if (k === 1) await page.screenshot({ path: '/tmp/film2/probe/follow_up.png' }); }
await browser.close(); process.exit(0);
