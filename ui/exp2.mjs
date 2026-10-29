// Experiment 2: header spacer, keyboard nav in model/variant menus, many webfetch rows,
// todo dock with 108 items, compaction in progress.
import { chromium } from 'playwright';
import fs from 'fs';
import { startMock, release, bus } from './mock2.mjs';

const OUT = '/tmp/film2/exp2'; fs.mkdirSync(OUT, { recursive: true });
const wf = (i) => ({ type: 'tool', name: 'webfetch', input: { url: `https://zh.wikipedia.org/wiki/条目${i}`, format: 'markdown' } });
const todos = (n) => ({ type: 'tool', name: 'todowrite', input: { todos: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), content: `Plan ${i + 1}: 重新定义“实现”`, status: i < n - 1 ? 'completed' : 'in_progress', priority: 'high' })) } });
const script = [];
for (let i = 0; i < 6; i++) script.push({ id: `m${i}`, blocks: [{ type: 'thinking', text: `Source batch ${i}.\n\n` }, wf(i * 4), wf(i * 4 + 1), wf(i * 4 + 2), wf(i * 4 + 3)] });
script.push({ id: 't37', blocks: [todos(37)] });
script.push({ id: 't108', blocks: [todos(108)] });
script.push({ id: 'g1', usage: { input_tokens: 196000 }, blocks: [{ type: 'text', text: '继续。' }] });
script.push({ id: 'g2', usage: { input_tokens: 196000 }, blocks: [{ type: 'thinking', text: 'Plan 109 …\n\n' }, { type: 'text', text: '继续。' }] });
script.push({ id: 'h', blocks: [{ type: 'thinking', text: 'Long thinking '.repeat(30) }] });
startMock({ port: 4320, script, logFile: '/tmp/film2/mock2.log' });
release('title');
let lastReq = -1; bus.on('main-request', (k, id) => { lastReq = k; console.log('req', k, id); });
let compacts = 0; bus.on('compact-request', (k) => { compacts++; console.log('compact-request', k); });

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
// header structure
console.log(await page.evaluate(() => { const h = document.querySelector('header'); return h ? h.outerHTML.slice(0, 1500) : 'no header'; }));
// keyboard nav model menu
await page.getByRole('button', { name: /Claude Opus 5\.5/ }).first().click(); await page.waitForTimeout(700); await shot('mm0');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await shot('mm1');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await shot('mm2');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await shot('mm3');
console.log('active option:', await page.evaluate(() => [...document.querySelectorAll('[data-selected="true"],[aria-selected="true"],[data-highlighted],[data-active="true"]')].map(e => e.textContent.trim().slice(0, 30)).join(' | ')));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.getByRole('button', { name: /Claude Opus 5\.5/ }).first().click(); await page.waitForTimeout(500);
await page.getByText('Mythos 10').first().click(); await page.waitForTimeout(600);
await page.getByRole('button', { name: '选择模型变体' }).click(); await page.waitForTimeout(600); await shot('vm0');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await shot('vm1');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await shot('vm3');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await shot('vm4');
await page.keyboard.press('Enter'); await page.waitForTimeout(500); await shot('vm_after');
const editor = page.locator('[contenteditable="true"]').first();
await editor.click(); await page.keyboard.insertText('英特纳雄耐尔是否能实现？'); await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
for (let i = 0; i < 6; i++) { release(`m${i}:start`); await page.waitForTimeout(900); }
await shot('webfetch_many');
release('t37:start'); await page.waitForTimeout(1500); await shot('todo37');
release('t108:start'); await page.waitForTimeout(1500); await shot('todo108');
release('g1:start'); await page.waitForTimeout(1500); await shot('compacting');
release('compact0'); await page.waitForTimeout(400); await shot('compact_text');
release('compact0:end'); await page.waitForTimeout(1500); await shot('compacted');
release('g2:start'); await page.waitForTimeout(1500); await shot('compacting2');
release('compact1'); release('compact1:end'); await page.waitForTimeout(1500); await shot('compacted2');
release('h:start'); await page.waitForTimeout(1500); await shot('thinking');
await browser.close();
process.exit(0);
