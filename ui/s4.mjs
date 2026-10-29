export default async function (page) {
  await page.screenshot({ path: 'newsess.png' });
  const html = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log(html);
}
