async page=>{
 const root=page.getByRole('dialog',{name:'解释：第 75 页选区',exact:true});
 if(!await root.locator('.answer-v2').innerText())throw Error('No root answer');
 await root.getByLabel('拖动解释窗').focus();
 const header=await root.getByLabel('拖动解释窗').boundingBox();
 await page.mouse.move(header.x+110,header.y+18);await page.mouse.down();await page.mouse.move(320,175,{steps:15});await page.mouse.up();
 const selection=await root.locator('.answer-v2').evaluate(el=>{
   const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
   while(node=walker.nextNode()){const at=node.textContent.indexOf('绑定');if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+2);const s=getSelection();s.removeAllRanges();s.addRange(range);return range.getBoundingClientRect().toJSON();}}
 });
 if(!selection)throw Error('Expected binding in answer');
 await page.mouse.click(selection.x+selection.width/2,selection.y+selection.height/2,{button:'right'});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/reading')&&r.request().method()==='POST');
 await page.getByRole('menuitem',{name:'询问 AI · 就地解释'}).click();
 const child=await(await response).json();if(!child.parentId)throw Error(JSON.stringify(child));
 await page.evaluate(id=>{const q=JSON.parse(localStorage.getItem('pointer-qa'));q.childId=id;localStorage.setItem('pointer-qa',JSON.stringify(q));},child.id);
 await page.screenshot({path:'output/playwright/pointer-recursive.png'});
 return{id:child.id,parentId:child.parentId,title:child.title,selection:child.selection.text};
}
