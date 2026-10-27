async page => {
  const context=await page.context().browser().newContext({viewport:{width:1440,height:980},deviceScaleFactor:1.5});
  const p=await context.newPage();
  try {
    await p.goto('http://127.0.0.1:4317/');
    await p.getByLabel('选择课件',{exact:true}).selectOption({label:'纯扫描 图形.pdf'});
    await p.getByLabel('缩放',{exact:true}).selectOption('1.25');
    await p.getByTitle('旋转页面',{exact:true}).click();
    await p.locator('.rendering').waitFor({state:'hidden'});
    await p.getByRole('button',{name:'框选提问',exact:true}).click();
    await p.locator('.page-scroll').evaluate(el=>{el.scrollTop=50;});
    const b=await p.locator('[data-testid=pdf-page]').boundingBox();
    await p.mouse.move(b.x+190*1.25,b.y+75*1.25);await p.mouse.down();
    await p.mouse.move(b.x+315*1.25,b.y+205*1.25,{steps:10});await p.mouse.up();
    await p.locator('.attached-context').click();
    const img=p.getByAltText('框选裁图预览',{exact:true});await img.waitFor();
    const src=await img.getAttribute('src'),url=new URL(src,'http://127.0.0.1:4317'),rect=JSON.parse(url.searchParams.get('rect'));
    [75,190,205,315].forEach((v,i)=>{if(Math.abs(rect[i]-v)>2)throw Error('High DPI rotated selection failed');});
    await img.evaluate(async el=>{if(!el.complete)await new Promise((resolve,reject)=>{el.onload=resolve;el.onerror=reject;});});
    await p.screenshot({path:'output/playwright/hidpi-rotation.png'});
    await p.getByLabel('缩放',{exact:true}).selectOption('0');
    for(let i=0;i<3;i++)await p.getByTitle('旋转页面',{exact:true}).click();
    const value=await p.evaluate(()=>devicePixelRatio);
    return {dpr:value,rotation:90,zoom:1.25,rect,passed:true};
  } finally {await context.close();}
}
