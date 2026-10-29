export default async function (page) {
  await page.keyboard.press('Meta+Comma'); await page.waitForTimeout(1500);
  await page.screenshot({ path: 'settings1.png' });
  const t = await page.evaluate(() => document.body.innerText.slice(0, 2500));
  console.log(t);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  console.log(keys);
}
