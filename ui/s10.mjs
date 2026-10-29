export default async function (page) {
  await page.evaluate(() => { localStorage.setItem('opencode-theme-id', 'dracula'); localStorage.removeItem('opencode-theme-css-dark'); });
  await page.goto('http://127.0.0.1:4399/server/aHR0cDovLzEyNy4wLjAuMTo0Mzk5/session/' + (await (await fetch('http://127.0.0.1:4399/session', {headers:{Authorization:'Basic '+Buffer.from('opencode:film').toString('base64')}})).json())[0].id, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: 'theme_dracula.png' });
}
