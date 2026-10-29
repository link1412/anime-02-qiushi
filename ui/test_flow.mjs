import { chromium } from 'playwright';
import { startMock, bus, release, reasoningChunkCount } from './mock.mjs';

startMock();
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 1473, height: 926 }, deviceScaleFactor: 1.5, colorScheme: 'dark',
  httpCredentials: { username: 'opencode', password: 'film' }, locale: 'zh-CN',
});
await ctx.addInitScript(() => {
  const s = {"general":{"autoSave":true,"releaseNotes":false,"followup":"steer","showFileTree":false,"showNavigation":false,"showSearch":false,"showStatus":false,"showTerminal":false,"showReasoningSummaries":true,"shellToolPartsExpanded":false,"editToolPartsExpanded":false,"showCustomAgents":true,"mobileTitlebarPosition":"top","layoutTransitionEligible":false,"agentVisibilityInitialized":true,"newLayoutDesigns":true,"shouldDisplayTabsToast":false},"appearance":{"fontSize":14,"mono":"","sans":"","terminal":""},"keybinds":{},"permissions":{"autoApprove":false},"notifications":{"agent":false,"permissions":false,"errors":false},"sounds":{"agentEnabled":false,"agent":"staplebops-01","permissionsEnabled":false,"permissions":"staplebops-02","errorsEnabled":false,"errors":"nope-03"}};
  if (!localStorage.getItem('settings.v3')) localStorage.setItem('settings.v3', JSON.stringify(s));
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4399/L1VzZXJzL3dhbmd5YW4vRGVza3RvcC9jbGF1ZGUtcC9lcDE/session', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);
// select project if needed
if (await page.getByText('新建项目').count()) {
  await page.getByText('新建项目').click(); await page.waitForTimeout(600);
  await page.keyboard.type('~/Desktop/claude-p/ep1'); await page.waitForTimeout(1200);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
}
// variant -> High
await page.screenshot({ path: 'tf_variant.png' });
if (await page.getByText('Default', { exact: true }).count()) {
  await page.getByText('Default', { exact: true }).click(); await page.waitForTimeout(500);
  await page.getByText('High', { exact: true }).last().click(); await page.waitForTimeout(500);
}

const cdp = await ctx.newCDPSession(page);
const editor = page.locator('[contenteditable="true"]').first();
await editor.click();
await cdp.send('Input.imeSetComposition', { text: 'ni jue d', selectionStart: 8, selectionEnd: 8 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'tf_comp.png' });
const caret = await page.evaluate(() => { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
console.log('caret', caret);
await cdp.send('Input.insertText', { text: '你觉得' });
await page.keyboard.insertText('这个世界上最伟大的四个字是什么。不需要理由,直接回答我。');
await page.waitForTimeout(300);
await page.screenshot({ path: 'tf_typed.png' });

bus.on('main-request', async k => {
  console.log('main-request', k);
});
await page.keyboard.press('Enter');
const t0 = Date.now();
let i = 0;
const shots = async (n, gap) => { for (let j = 0; j < n; j++) { await page.screenshot({ path: `tf_busy_${String(i++).padStart(2, '0')}.png` }); await page.waitForTimeout(gap); } };
await shots(4, 400);
release('r0:start');
await shots(2, 300);
const n = reasoningChunkCount(0);
for (let q = 0; q < n; q++) { release(`r0:th${q}`); if (q % 6 === 0) await shots(1, 50); }
await shots(2, 300);
release('r0:text'); await shots(2, 300);
release('r0:end'); await shots(3, 500);
console.log('done', Date.now() - t0);
await browser.close();
process.exit(0);
