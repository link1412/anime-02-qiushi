export default async function (page) {
  if (await page.getByText('新建项目').count()) {
    await page.getByText('新建项目').click(); await page.waitForTimeout(600);
    await page.keyboard.type('~/Desktop/claude-p/ep1'); await page.waitForTimeout(1200);
    await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: 'variant0.png' });
  const items = await page.$$eval('button', els => els.map(e => (e.getAttribute('aria-label')||'') + ' | ' + e.textContent.trim() + ' | ' + e.getAttribute('data-slot')));
  console.log(items.join('\n'));
}
