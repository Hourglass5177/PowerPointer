async page=>{
const dialog=page.getByRole('dialog',{name:'解释：绑定',exact:true});
await dialog.getByRole('button',{name:'还原解释窗'}).click();
await dialog.getByRole('button',{name:'解释窗设置'}).click();
const response=page.waitForResponse(r=>r.url().endsWith('/promote')&&r.request().method()==='POST');
await dialog.getByRole('button',{name:'保存为正式对话'}).click();
const saved=await(await response).json();
await dialog.getByRole('button',{name:'关闭解释窗',exact:true}).click();
const state=await page.evaluate(async id=>({conversation:await(await fetch('/api/conversations/'+id)).json(),reading:await(await fetch('/api/reading')).json()}),saved.id);
if(!state.conversation.turns?.length)throw Error('Promoted conversation missing');
const text=JSON.stringify(state.conversation.turns);
if(!text.includes('银杏树'))throw Error('Inherited history missing');
if(state.reading.sessions.length)throw Error('Closed sessions still present');
await page.evaluate(v=>{const s=JSON.parse(localStorage.getItem('pointer-qa'));s.promoted=v;localStorage.setItem('pointer-qa',JSON.stringify(s));},saved.id);
await page.getByRole('button',{name:'课程与资料',exact:true}).click();
await page.getByRole('button',{name:'资料库',exact:true}).click();
return{savedId:saved.id,turns:state.conversation.turns.length};
}
