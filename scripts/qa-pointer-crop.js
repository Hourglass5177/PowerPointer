async page=>{
 const check=(v,m)=>{if(!v)throw Error(m);};
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'框选解释',exact:true}).click();
 const box=await page.getByTestId('pdf-page').boundingBox();check(box,'PDF visible');
 const reply=page.waitForResponse(r=>r.url().endsWith('/api/reading')&&r.request().method()==='POST');
 await page.mouse.move(box.x+box.width*.12,box.y+box.height*.67);await page.mouse.down();await page.mouse.move(box.x+box.width*.88,box.y+box.height*.91,{steps:15});await page.mouse.up();
 const session=await(await reply).json();check(session.id,'window created: '+JSON.stringify(session));
 await page.getByRole('dialog',{name:/解释：/}).waitFor();
 await page.evaluate(id=>{const s=JSON.parse(localStorage.getItem('pointer-qa'));s.rootId=id;localStorage.setItem('pointer-qa',JSON.stringify(s));},session.id);
 await page.getByRole('textbox',{name:'页码',exact:true}).fill('76');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');
 await page.screenshot({path:'output/playwright/pointer-crop-in-progress.png'});
 return {id:session.id,selection:session.selection,layout:session.layout};
}
