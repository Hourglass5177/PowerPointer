async page => {
 await page.getByRole('combobox',{name:'选择课件'}).selectOption({label:'0Lecture 1-lg-0320.pptx'});
 await page.getByRole('textbox',{name:'页码',exact:true}).fill('51');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');
 await page.getByRole('button',{name:'新建会话',exact:true}).click();await page.getByRole('heading',{name:'从这一页开始'}).waitFor();
 await page.getByRole('button',{name:'选择模型与思考强度'}).click();await page.getByRole('button',{name:/GPT-6.1-Sol/}).click();await page.getByRole('button',{name:'轻量',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'提问范围'}).click();await page.getByRole('button',{name:/附近页/}).click();
 const q='我正在学第51页。请结合附近的求和例子解释：什么才算尾递归？为什么 return i + sum(i+1,j) 不算？用三点讲清楚，并说明“尾递归一定不增长栈”是否需要前提，引用对应课件页。';
 await page.getByRole('textbox',{name:'向课件提问'}).fill(q);
 const promise=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');await page.getByRole('textbox',{name:'向课件提问'}).press('Enter');const t=await(await promise).json();
 await page.evaluate(t=>localStorage.setItem('powerpointer-qa',JSON.stringify({documentId:t.snapshot.documentId,conversationId:t.conversationId,turns:[t.id]})),t);
 await page.screenshot({path:'output/playwright/user-course-first-send.png'});return{id:t.id,conversationId:t.conversationId,page:t.snapshot.page,model:t.snapshot.model,effort:t.snapshot.reasoningEffort};
}
