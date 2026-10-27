async page=>{
 const check=(v,m)=>{if(!v)throw Error(m);};
 const header=page.getByRole('dialog',{name:'解释：绑定',exact:true}).getByLabel('拖动解释窗');const hb=await header.boundingBox();await page.mouse.move(hb.x+80,hb.y+18);await page.mouse.down();await page.mouse.move(1180,180,{steps:12});await page.mouse.up();
 await page.getByRole('combobox',{name:'选择课件'}).selectOption({label:'第一章-作用域.pdf'});
 await page.locator('.rendering').waitFor({state:'hidden'});
 const tool=page.getByRole('button',{name:'框选引用',exact:true});if(await tool.getAttribute('aria-pressed')!=='true')await tool.click();
 const box=await page.getByTestId('pdf-page').boundingBox();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/selections')&&r.request().method()==='POST');
 await page.mouse.move(box.x+box.width*.16,box.y+box.height*.31);await page.mouse.down();await page.mouse.move(box.x+box.width*.79,box.y+box.height*.62,{steps:12});await page.mouse.up();
 const selection=await(await response).json();check(selection.image,'frozen image');
 await page.getByRole('combobox',{name:'选择课件'}).selectOption({label:'第二章-动态绑定.pdf'});await page.getByRole('button',{name:'旋转',exact:true}).click();await page.getByRole('textbox',{name:'页码',exact:true}).fill('2');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');
 await page.locator('.reference-card').waitFor();check((await page.locator('.reference-card img').getAttribute('src')).endsWith(selection.image),'card remains immutable');
 let captured;
 await page.route('**/api/turns',async route=>{captured=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'受控验证：本次仅检查引用快照，没有调用模型'})});});
 await page.getByRole('textbox',{name:'向课件提问'}).fill('只检查截图上下文');await page.getByRole('button',{name:'发送问题',exact:true}).click();await page.getByRole('alert').waitFor();await page.unroute('**/api/turns');
 check(captured.snapshot.documentId===selection.documentId,'snapshot sticks to selected source across chapters');check(captured.snapshot.page===selection.page&&captured.snapshot.rotation===0,'page and rotation frozen');check(captured.snapshot.selections[0].image===selection.image,'same frozen attachment submitted');
 await page.screenshot({path:'output/playwright/pointer-reference-frozen.png'});
 await page.getByRole('button',{name:'关闭提示'}).click();await page.getByRole('button',{name:'移除引用',exact:true}).click();await page.getByRole('textbox',{name:'向课件提问'}).fill('请实际调用课件阅读工具分别读取“第一章-作用域.pdf”第1页和“第二章-动态绑定.pdf”第1页的图像，然后用两句话对比这两页的重点，分别引用各自来源。');
 const result=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题',exact:true}).click();const turn=await(await result).json();
 return {selection,snapshot:captured.snapshot,toolCheckTurn:turn.id};
}
