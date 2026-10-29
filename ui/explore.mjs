import { chromium } from 'playwright';
// usage: node explore.mjs <url> <steps.mjs>
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 1473, height: 926 }, deviceScaleFactor: 1.5, colorScheme: 'dark',
  httpCredentials: { username: 'opencode', password: 'film' }, locale: 'zh-CN',
});
await ctx.addInitScript(() => {
  const s = {"general":{"autoSave":true,"releaseNotes":false,"followup":"steer","showFileTree":false,"showNavigation":false,"showSearch":false,"showStatus":false,"showTerminal":false,"showReasoningSummaries":true,"shellToolPartsExpanded":false,"editToolPartsExpanded":false,"showCustomAgents":true,"mobileTitlebarPosition":"top","layoutTransitionEligible":false,"agentVisibilityInitialized":true,"newLayoutDesigns":true,"shouldDisplayTabsToast":false},"appearance":{"fontSize":14,"mono":"","sans":"","terminal":""},"keybinds":{},"permissions":{"autoApprove":false},"notifications":{"agent":false,"permissions":false,"errors":false},"sounds":{"agentEnabled":false,"agent":"staplebops-01","permissionsEnabled":false,"permissions":"staplebops-02","errorsEnabled":false,"errors":"nope-03"}};
  if (!localStorage.getItem('settings.v3')) localStorage.setItem('settings.v3', JSON.stringify(s));
  localStorage.setItem('highlights.v1', JSON.stringify({ version: '1.19.5' }));
});
const page = await ctx.newPage();
page.on('console', m => { if (process.env.CONSOLE) console.log('[console]', m.text()); });
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);
console.log('url:', page.url());
const mod = await import(process.argv[3] + '?t=' + Date.now());
await mod.default(page, ctx);
await browser.close();
