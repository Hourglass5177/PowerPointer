async page=>{
 const created=await page.evaluate(async()=>{
  const {csrf}=await(await fetch('/api/bootstrap')).json();const courseId=document.querySelector('[aria-label="当前课程"]').value;const conversationId=localStorage.getItem('lecture-conv-course-'+courseId);const documentId=document.querySelector('[aria-label="选择课件"]').value;const ids=[];
  for(let i=0;i<5;i++){const id=crypto.randomUUID();const result=await fetch('/api/reading',{method:'POST',headers:{'Content-Type':'application/json','X-Lecture-Token':csrf},body:JSON.stringify({id,conversationId,selection:{id:crypto.randomUUID(),kind:'text',documentId,page:1,rotation:0,text:'作用域 · '+(i+1)},settings:{model:'gpt-6.1-sol'},layout:{x:(i%3)*.32+.02,y:Math.floor(i/3)*.55+.2,width:340,height:250,minimized:false}})});if(!result.ok)throw Error(await result.text());ids.push(id);}
  return ids;
 });
 await page.getByRole('dialog',{name:'解释：作用域 · 5',exact:true}).waitFor();
 const expanded=await page.locator('.reading-window:not(.minimized)').count();if(expanded!==5)throw Error('Windows auto-collapsed: '+expanded);
 await page.screenshot({path:'output/playwright/pointer-six-windows.png'});
 await page.setViewportSize({width:520,height:850});
 await page.getByRole('navigation',{name:'打开的解释窗'}).getByRole('button',{name:'作用域 · 2',exact:true}).click();
 const win=page.getByRole('dialog',{name:'解释：作用域 · 2',exact:true});await win.waitFor({state:'visible'});
 const b=await win.boundingBox();if(b.x<0||b.x+b.width>520||b.y+b.height>850)throw Error('Mobile window outside viewport');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 await page.screenshot({path:'output/playwright/pointer-narrow-windows.png'});
 await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:'output/playwright/pointer-1920.png'});
 await page.evaluate(async ids=>{const {csrf}=await(await fetch('/api/bootstrap')).json();for(const id of ids){await fetch('/api/reading/'+id,{method:'DELETE',headers:{'X-Lecture-Token':csrf}});await fetch('/api/reading/'+id,{method:'DELETE',headers:{'X-Lecture-Token':csrf}});}},created);
 await page.setViewportSize({width:1440,height:900});return {created:created.length,unminimized:expanded,narrowBounds:b};
}
