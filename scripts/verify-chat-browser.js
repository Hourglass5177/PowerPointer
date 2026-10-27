async page => {
 await page.unroute('**/api/turns');
 const check=(c,m)=>{if(!c)throw Error(m)};
 await page.getByRole('combobox',{name:'选择课件'}).selectOption({label:'微积分 图形验证.pptx'});
 await page.getByRole('button',{name:'新建会话',exact:true}).click();
 await page.getByRole('heading',{name:'从这一页开始'}).waitFor();
 const input=page.getByRole('textbox',{name:'向课件提问'});
 await input.fill('草稿甲');await input.press('Shift+Enter');await input.type('第二行');
 check((await input.inputValue()).includes('\n'),'ShiftEnter newline');
 const convA=await page.evaluate(()=>localStorage.getItem('lecture-conv-'+localStorage.getItem('lecture-last-doc')));
 await page.getByRole('button',{name:'新建会话',exact:true}).click();await page.waitForFunction(id=>localStorage.getItem('lecture-conv-'+localStorage.getItem('lecture-last-doc'))!==id,convA);
 check(await input.inputValue()==='','new conversation empty');await input.fill('草稿乙');
 await page.getByRole('button',{name:'会话历史',exact:true}).click();
 const items=page.locator('.history-item');await items.nth(1).locator('.history-select').click();
 check(await input.inputValue()==='草稿甲\n第二行','draft restored in old conversation');
 await page.reload();await input.waitFor();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='草稿甲\n第二行');check(await input.inputValue()==='草稿甲\n第二行','draft restored after reload');
 let sends=0, submitted;
 await page.route('**/api/turns',async route=>{sends++;submitted=route.request().postDataJSON();await new Promise(r=>setTimeout(r,400));await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'受控验收：额度错误'})});});
 await input.dispatchEvent('compositionstart');await input.press('Enter');check(sends===0,'IME Enter no send');await input.dispatchEvent('compositionend');await input.fill('草稿甲\n第二行');
 await page.getByRole('button',{name:'选择模型与思考强度'}).click();await page.getByRole('button',{name:/GPT-6-Luna/}).click();await page.getByRole('button',{name:'深入',exact:true}).click();await page.getByRole('button',{name:'关闭模型与思考强度'}).click();
 await page.getByRole('button',{name:'阅读工具与联网'}).click();await page.getByRole('checkbox',{name:/网络搜索与网页阅读/}).check();await page.getByRole('checkbox',{name:/课件工具/}).uncheck();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'提问范围'}).click();await page.getByRole('button',{name:/整份课件检索/}).click();
 await input.press('Enter');await page.getByRole('alert').waitFor();check(sends===1,'Enter sent once');
 check(submitted.snapshot.model==='gpt-6-luna'&&submitted.snapshot.reasoningEffort==='high'&&submitted.snapshot.webSearch&&!submitted.snapshot.agentTools,'AI controls submitted');
 check(await input.inputValue()==='草稿甲\n第二行','failure keeps draft');
 await page.screenshot({path:'output/playwright/chat-error.png'});
 await page.unroute('**/api/turns');await page.getByRole('button',{name:'关闭提示'}).click();
 await page.getByRole('button',{name:'会话历史',exact:true}).click();
 const row=page.locator('.history-item.current');await row.getByRole('button',{name:/重命名/}).click();await page.getByRole('textbox',{name:'新的会话名称'}).fill('交互验收草稿');await page.getByRole('button',{name:'保存',exact:true}).click();
 await row.getByRole('button',{name:'置顶',exact:true}).click();await row.getByRole('button',{name:'取消置顶',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'搜索会话标题与消息'}).fill('交互验收草稿');await page.waitForFunction(()=>document.querySelectorAll('.history-item').length===1);
 await row.getByRole('button',{name:'归档',exact:true}).click();await page.getByRole('button',{name:'已归档',exact:true}).click();await row.getByRole('button',{name:'恢复会话',exact:true}).click();await page.getByRole('button',{name:'最近',exact:true}).click();
 await row.locator('.history-select').click();check(await input.inputValue()==='草稿甲\n第二行','archive restore retains draft');
 await page.getByRole('button',{name:'展开问答',exact:true}).click();check(await page.locator('.chat-expanded').isVisible(),'expanded');await page.screenshot({path:'output/playwright/chat-expanded-empty.png'});await page.keyboard.press('Escape');check(await page.locator('.chat-expanded').count()===0,'Escape collapses');
 await page.setViewportSize({width:760,height:900});await page.getByRole('button',{name:'问答',exact:true}).click();check(await input.isVisible(),'narrow drawer');await page.screenshot({path:'output/playwright/chat-narrow.png'});await page.setViewportSize({width:1440,height:900});
 await input.fill('');
 return {draftIsolation:true,reload:true,ime:true,enter:true,settings:submitted.snapshot,history:true,expanded:true,narrow:true};
}


