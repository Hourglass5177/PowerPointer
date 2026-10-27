async page=>{
 const check=(v,m)=>{if(!v)throw Error(m);};
 const child=page.getByRole('dialog',{name:'解释：绑定',exact:true});
 const resize=await child.getByRole('button',{name:'调整解释窗大小'}).boundingBox();
 await page.mouse.move(resize.x+4,resize.y+4);await page.mouse.down();await page.mouse.move(resize.x+94,resize.y-36,{steps:10});await page.mouse.up();
 await child.getByRole('textbox',{name:'解释窗追问'}).fill('只列出创建这个解释窗之前我们的学习暗号；之后在右侧添加的新暗号如果不知道就说不知道。再用两点解释绑定和赋值的区别。');
 await child.getByRole('textbox',{name:'解释窗追问'}).blur();
 const saved=await page.evaluate(async()=>{const s=await(await fetch('/api/reading')).json();return s.sessions;});
 await page.getByRole('dialog',{name:'解释：第 75 页选区',exact:true}).getByRole('button',{name:'关闭解释窗',exact:true}).click();
 check(await child.isVisible(),'child survives closing parent');
 await page.reload();
 await page.getByRole('dialog',{name:'解释：绑定',exact:true}).waitFor();
 const restored=page.getByRole('dialog',{name:'解释：绑定',exact:true});
 check((await restored.getByRole('textbox',{name:'解释窗追问'}).inputValue()).startsWith('只列出'),'draft restored');
 check(await page.getByRole('dialog',{name:'解释：第 75 页选区',exact:true}).count()===0,'closed parent not resurrected');
 const size=await restored.boundingBox();check(size.width>450,'resized width restored');
 await page.screenshot({path:'output/playwright/pointer-child-restored.png'});
 return {saved:saved.map(s=>({id:s.id,layout:s.layout,draft:s.draft})),restoredSize:size};
}
