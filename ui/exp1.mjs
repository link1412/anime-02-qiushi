// Experiment: Mythos 10 model + variant menu, webfetch/todowrite tool calls, compaction, 403 errors.
import { chromium } from 'playwright';
import { startMock, release, bus, stats } from './mock2.mjs';

const OUT = '/tmp/film2/exp';
import fs from 'fs'; fs.mkdirSync(OUT, { recursive: true });
const script = [
  { id: 'q', startGate: false, blocks: [
    { type: 'thinking', text: 'Big question. Gather primary sources first.\n\n' },
    { type: 'tool', name: 'webfetch', input: { url: 'https://www.marxists.org/archive/marx/works/1848/communist-manifesto/', format: 'markdown' } },
    { type: 'tool', name: 'webfetch', input: { url: 'https://zh.wikipedia.org/wiki/巴黎公社', format: 'markdown' } },
    { type: 'tool', name: 'webfetch', input: { url: 'https://en.wikipedia.org/wiki/The_Internationale', format: 'markdown' } },
  ] },
  { id: 'todo', startGate: false, blocks: [
    { type: 'tool', name: 'todowrite', input: { todos: Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), content: `Plan ${i + 1}: 重新定义“实现”`, status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'pending', priority: 'high' })) } },
  ] },
  { id: 'big', startGate: false, usage: { input_tokens: 196000 }, blocks: [ { type: 'thinking', text: 'Plan 13 …\n\n' }, { type: 'text', text: '继续。' } ] },
  { id: 'e1', startGate: false, error: { status: 403, type: 'permission_error', message: 'Forbidden' } },
  { id: 'e2', startGate: false, error: { status: 403, type: 'permission_error', message: 'Forbidden' } },
  { id: 'e3', startGate: false, error: { status: 403, type: 'permission_error', message: 'This organization has been disabled.' } },
];
startMock({ port: 4320, script, logFile: '/tmp/film2/mock.log' });
release('title');
bus.on('main-request', (k, id) => console.log('main-request', k, id));
bus.on('compact-request', (k) => { console.log('compact-request', k); release(`compact${k}`); release(`compact${k}:end`); });

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1473, height: 926 }, deviceScaleFactor: 1.5, colorScheme: 'dark', httpCredentials: { username: 'opencode', password: 'film' }, locale: 'zh-CN' });
await ctx.addInitScript(() => {
  const s = {"general":{"autoSave":true,"releaseNotes":false,"followup":"steer","showFileTree":false,"showNavigation":false,"showSearch":false,"showStatus":false,"showTerminal":false,"showReasoningSummaries":true,"shellToolPartsExpanded":false,"editToolPartsExpanded":false,"showCustomAgents":true,"mobileTitlebarPosition":"top","layoutTransitionEligible":false,"agentVisibilityInitialized":true,"newLayoutDesigns":true,"shouldDisplayTabsToast":false},"appearance":{"fontSize":14,"mono":"","sans":"","terminal":""},"keybinds":{},"permissions":{"autoApprove":false},"notifications":{"agent":false,"permissions":false,"errors":false},"sounds":{"agentEnabled":false,"agent":"staplebops-01","permissionsEnabled":false,"permissions":"staplebops-02","errorsEnabled":false,"errors":"nope-03"}};
  localStorage.setItem('settings.v3', JSON.stringify(s));
  localStorage.setItem('opencode-theme-id', 'dracula');
});
const page = await ctx.newPage();
let n = 0; const shot = async (name) => { await page.screenshot({ path: `${OUT}/${String(n++).padStart(2, '0')}_${name}.png` }); };
await page.goto('http://127.0.0.1:4398/L1VzZXJzL3dhbmd5YW4vRGVza3RvcC9jbGF1ZGUtcC9lcDE/session', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(7000);
if (await page.getByText('新建项目').count()) {
  await page.getByText('新建项目').click(); await page.waitForTimeout(700);
  await page.keyboard.type('~/Desktop/claude-p/ep1'); await page.waitForTimeout(1500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
}
await shot('home');
// model picker
const mbtn = page.getByRole('button', { name: /Claude Opus 5\.5/ }).first();
await mbtn.click(); await page.waitForTimeout(800); await shot('model_menu');
console.log('model menu texts:', (await page.locator('[role=option], [role=menuitem], [cmdk-item], li').allInnerTexts()).slice(0, 40).join(' | '));
const myth = page.getByText('Mythos 10').first();
if (await myth.count()) { await myth.scrollIntoViewIfNeeded(); await shot('model_menu_myth'); await myth.click(); await page.waitForTimeout(800); }
await shot('after_model');
const vbtn = page.getByRole('button', { name: '选择模型变体' });
if (await vbtn.count()) { await vbtn.click(); await page.waitForTimeout(700); await shot('variant_menu'); }
const ul = page.getByText(/ululululultra/i).last();
if (await ul.count()) { await ul.click(); await page.waitForTimeout(700); }
await shot('after_variant');
const editor = page.locator('[contenteditable="true"]').first();
await editor.click(); await page.keyboard.insertText('英特纳雄耐尔是否能实现？'); await page.keyboard.press('Enter');
for (let i = 0; i < 16; i++) { await page.waitForTimeout(700); if (i % 3 === 2) await shot('run' + i); }
await page.waitForTimeout(3000); await shot('after_run');
for (const msg of ['continue', 'whats the matter', 'hello?']) {
  await editor.click(); await page.keyboard.insertText(msg); await page.keyboard.press('Enter');
  await page.waitForTimeout(2500); await shot('err_' + msg.replace(/\W+/g, '_'));
}
console.log('stats', JSON.stringify(stats));
await browser.close();
process.exit(0);
