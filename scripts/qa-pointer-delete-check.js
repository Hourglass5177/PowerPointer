async page=>{
const result=await page.evaluate(async()=>{const turns=await(await fetch('/api/conversations/d01ce2cd-5967-4bdb-8c85-97fb85be48f9/turns')).json();const sources=turns.flatMap(t=>[...t.snapshot.sources,...(t.toolSources||[])]).filter(s=>s.documentId==='d60197f5b1e9bc901d8f4bbab1a75386643258f746c9f7267ac01b809550cfa2');if(!sources.length||!sources.every(s=>s.deleted))throw Error('Deleted sources not marked');return{retainedTurns:turns.length,deletedSourceLabels:sources.length};});
await page.getByRole('button',{name:'全部会话',exact:true}).click();await page.getByRole('textbox',{name:'搜索全部会话'}).fill('银杏树');return result;
}
