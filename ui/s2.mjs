export default async function (page) {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('settings.v3'));
    s.general.showReasoningSummaries = true;
    s.general.showCustomAgents = true;
    localStorage.setItem('settings.v3', JSON.stringify(s));
    console.log(JSON.stringify(s));
  });
  console.log(await page.evaluate(() => localStorage.getItem('settings.v3')));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'withreason.png' });
}
