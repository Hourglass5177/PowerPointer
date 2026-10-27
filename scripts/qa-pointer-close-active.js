async page=>{
 await page.locator('.rendering').waitFor({state:'hidden'});
 const text=page.locator('.textLayer span').filter({hasText:'声明'}).first();await text.click({button:'right'});
 const created=page.waitForResponse(r=>r.url().endsWith('/api/reading')&&r.request().method()==='POST');const asked=page.waitForResponse(r=>r.url().includes('/api/reading/')&&r.url().endsWith('/turns')&&r.request().method()==='POST');
 await page.getByRole('menuitem',{name:'询问 AI · 就地解释'}).click();const session=await(await created).json(),turn=await(await asked).json();
 await page.getByRole('dialog',{name:'解释：'+session.title,exact:true}).getByRole('button',{name:'关闭解释窗',exact:true}).click();
 const state=await page.evaluate(async()=>await(await fetch('/api/reading')).json());if(state.sessions.some(s=>s.id===session.id)||state.turns.some(t=>t.id===turn.id))throw Error('Closed active window still persisted');
 await page.evaluate(v=>{const s=JSON.parse(localStorage.getItem('pointer-qa'));s.closedActive=v;localStorage.setItem('pointer-qa',JSON.stringify(s));},{sessionId:session.id,turnId:turn.id});
 return{sessionId:session.id,turnId:turn.id,atClose:turn.state};
}
