export default async function (page) {
  if (await page.getByText('新建项目').count()) {
    await page.getByText('新建项目').click(); await page.waitForTimeout(600);
    await page.keyboard.type('~/Desktop/claude-p/ep1'); await page.waitForTimeout(1200);
    await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  }
  await page.getByRole('button', { name: '选择模型变体' }).click(); await page.waitForTimeout(700);
  await page.screenshot({ path: 'variant_menu.png' });
  const items = await page.$$eval('[role=option],[role=menuitem],[role=menuitemradio],[role=listbox] *', els => els.map(e => e.getAttribute('role') + ':' + e.textContent.trim()).filter(s => s.length < 40));
  console.log(items.join('\n'));
  await page.getByRole('option', { name: /high/i }).first().click().catch(async e => { console.log('no option role'); await page.getByText(/^high$/i).last().click(); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'variant_after.png' });
}
