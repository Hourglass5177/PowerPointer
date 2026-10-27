async page=>{
const check=(v,m)=>{if(!v)throw Error(m)};
await page.setViewportSize({width:1440,height:900});await page.locator('.rendering').waitFor({state:'hidden'});
let modelRequests=0;const count=r=>{if(r.method()==='POST'&&(/\/api\/reading\/[^/]+\/turns$/.test(r.url())||r.url().endsWith('/api/turns')))modelRequests++};page.on('request',count);
const crop=async()=>{await page.getByRole('button',{name:'框选',exact:true}).click();const b=await page.getByTestId('pdf-page').boundingBox();await page.mouse.move(b.x+b.width*.17,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.67,b.y+b.height*.57,{steps:10});await page.mouse.up();await page.getByRole('menu',{name:'选区操作'}).waitFor();check(await page.locator('.selection-box').count()===1,'pending crop visible');};
await crop();check(modelRequests===0,'drawing must not generate');await page.screenshot({path:'output/playwright/pointer-unified-menu.png'});
await page.keyboard.press('Escape');check(await page.locator('.selection-box').count()===0,'Escape clears crop');
await crop();await page.getByRole('button',{name:'阅读／选字',exact:true}).click();check(await page.locator('.selection-box').count()===0,'outside clears crop');
await crop();await page.keyboard.press('ArrowDown');check(await page.getByRole('menuitem',{name:'对话引用',exact:true}).evaluate(e=>e===document.activeElement),'keyboard menu');
const response=page.waitForResponse(r=>r.url().endsWith('/api/selections')&&r.request().method()==='POST');await page.keyboard.press('Enter');const selection=await(await response).json();await page.locator('.reference-card').waitFor();check(await page.locator('.selection-box').count()===0,'reference clears crop');check(modelRequests===0,'reference must not generate');
await page.getByRole('button',{name:'旋转',exact:true}).click();check((await page.locator('.reference-card img').getAttribute('src')).endsWith(selection.image),'frozen image remains');
await page.getByRole('button',{name:'移除引用',exact:true}).click();await page.locator('.rendering').waitFor({state:'hidden'});
await crop();await page.route('**/api/reading/*/turns',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'受控 UI 验证：未调用模型'})}));await page.getByRole('menuitem',{name:'弹窗解释',exact:true}).click();await page.getByRole('dialog',{name:/解释：/}).waitFor();check(await page.locator('.selection-box').count()===0,'explanation clears crop');await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'关闭解释窗',exact:true}).click();await page.getByRole('button',{name:'关闭提示',exact:true}).click();await page.unroute('**/api/reading/*/turns');page.off('request',count);
await page.getByRole('button',{name:/^整体理解/}).click();await page.getByRole('heading',{name:'从每一页，连接到整门课'}).waitFor();await page.screenshot({path:'output/playwright/pointer-knowledge-hub.png'});
return{menu:true,cancel:true,referenceFrozen:true,explanationCleared:true,modelRequestsIntercepted:modelRequests};
}
