import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:4199/';
const out = process.argv[3] || 'probe.png';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 2209, height: 1389 }, deviceScaleFactor: 1, colorScheme: 'dark',
  httpCredentials: { username: 'opencode', password: 'film' }, locale: 'zh-CN',
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(10000);
console.log(page.url());
await page.screenshot({ path: out });
const links = await page.$$eval('a', as => as.map(a => a.href + ' | ' + a.textContent.trim().slice(0, 40)).slice(0, 40));
console.log(links.join('\n'));
await browser.close();
