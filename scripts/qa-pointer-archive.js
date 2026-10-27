async page=>{
const id='6cadb2da-8ff2-4ef5-9828-e76af4d230cc';
await page.evaluate(async id=>{const{csrf}=await(await fetch('/api/bootstrap')).json();const r=await fetch('/api/conversations/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','X-Lecture-Token':csrf},body:JSON.stringify({archived:true})});if(!r.ok)throw Error(await r.text());},id);
await page.getByRole('button',{name:'资料库',exact:true}).click();await page.getByRole('button',{name:'全部会话',exact:true}).click();
return{id};
}
