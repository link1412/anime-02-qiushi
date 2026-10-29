export default async function (page) {
  const html = await page.evaluate(() => {
    const ed = document.querySelector('[contenteditable="true"]');
    let p = ed; for (let i = 0; i < 3; i++) p = p.parentElement;
    return p.outerHTML.slice(0, 3000) + '\n\nSTYLE:' + JSON.stringify((({fontFamily,fontSize,lineHeight,color,caretColor})=>({fontFamily,fontSize,lineHeight,color,caretColor}))(getComputedStyle(ed)));
  });
  console.log(html);
  const tb = await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='主页'); let p=b; for(let i=0;i<3;i++) p=p.parentElement; return p.outerHTML.slice(0,2500); });
  console.log('\n\nTITLEBAR:', tb);
}
