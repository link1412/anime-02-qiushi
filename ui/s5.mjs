export default async function (page) {
  await page.getByText('新建项目').click();
  await page.waitForTimeout(800);
  await page.keyboard.type('~/Desktop/claude-p/ep1');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'projdd.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  console.log(page.url());
  await page.screenshot({ path: 'projsel.png' });
}
