async page=>{
const check=(v,m)=>{if(!v)throw Error(m)};
const failures=[],checks=[];await page.keyboard.press('Escape');await page.reload();
const nav=async name=>{if(!await page.getByRole('navigation',{name:'工作区',exact:true}).isVisible())await page.getByRole('button',{name:'切换导航',exact:true}).click();await page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('button',{name,exact:true}).click();};
await page.setViewportSize({width:1440,height:900});
await nav('阅读');await page.getByRole('textbox',{name:'向课件提问'}).fill('界面改版验收草稿');
await page.getByRole('textbox',{name:'页码',exact:true}).fill('2');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');
await page.getByRole('slider',{name:'缩放滑块'}).fill('125');await page.waitForFunction(()=>document.querySelector('.zoom-value')?.textContent==='125%');
for(const name of ['总览','资料','历史','阅读'])await nav(name);
check(await page.getByRole('textbox',{name:'页码',exact:true}).inputValue()==='2','Page preserved');check(await page.getByRole('textbox',{name:'向课件提问'}).inputValue()==='界面改版验收草稿','Draft preserved');check(await page.getByRole('slider',{name:'缩放滑块'}).inputValue()==='125','Zoom preserved');checks.push('page/zoom/draft round trip');
await page.getByRole('button',{name:'提问设置',exact:true}).click();for(const label of ['范围','思考强度','回答长度'])await page.getByRole('dialog',{name:'提问设置'}).getByRole('combobox',{name:label,exact:true}).waitFor();await page.keyboard.press('Escape');checks.push('composer settings keyboard close');
for(const width of [1920,1440,1024,520]){
 await page.setViewportSize({width,height:900});
 for(const name of ['阅读','总览','资料','历史']){
 await nav(name);if(name==='历史')await page.locator('.history-page[aria-busy=false]').waitFor();if(name==='总览')await page.locator('.overview-page[aria-busy=false]').waitFor();
 check(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),name+' overflow '+width);
 await page.screenshot({path:'output/playwright/workspace-'+name+'-'+width+'.png'});
 if(name==='总览'){const box=await page.getByRole('button',{name:'生成总览',exact:true}).boundingBox();check(box&&box.y>=0&&box.y+box.height<900,'CTA visible '+width);}
 }
 checks.push('four workspaces at '+width);
}
await nav('阅读');await page.getByRole('button',{name:'对话',exact:true}).click();check(!(await page.getByRole('region',{name:'课件阅读区'}).isVisible()),'mobile single panel');await page.getByRole('button',{name:'提问设置',exact:true}).click();await page.screenshot({path:'output/playwright/workspace-mobile-chat-settings.png'});await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回课件',exact:true}).click();checks.push('mobile chat/settings reachable');
await page.setViewportSize({width:1440,height:900});await nav('资料');await page.getByRole('button',{name:'全部资料',exact:true}).click();await page.getByRole('button',{name:'彻底删除…',exact:true}).first().click();await page.getByRole('alertdialog',{name:'确认删除课件'}).waitFor();check((await page.getByRole('alertdialog').innerText()).includes('硬盘原文件保留'),'delete consequences retained');await page.screenshot({path:'output/playwright/workspace-delete-confirm.png'});await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).click();checks.push('delete impact');
await nav('总览');return{checks,failures};
}


