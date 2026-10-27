async page=>{
return await page.evaluate(async()=>{const all=await(await fetch('/api/conversations')).json();if(all.some(c=>c.id==='6cadb2da-8ff2-4ef5-9828-e76af4d230cc'))throw Error('Still present');if(!all.some(c=>c.id==='e243f752-fb04-450a-bca5-a81b84286592'))throw Error('Promoted missing');return{archivedDeleted:true,promotedIntact:true,pending:await(await fetch('/api/cleanup')).json()};});
}
