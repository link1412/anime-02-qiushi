export default async function (page) {
  const ls = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).map(([k, v]) => [k, v.slice(0, 300)])));
  console.log(JSON.stringify(ls, null, 1));
  await page.getByText('实事求是。').hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'hover.png' });
}
