async page => {
 const web=page.getByTestId('turn-510cbf61-28f1-4709-a1cd-2916f9db7346');await web.getByRole('button',{name:'追问',exact:true}).waitFor();
 await page.getByRole('button',{name:'展开问答',exact:true}).click();await web.scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/powerpointer-web-answer.png'});await page.getByRole('button',{name:'返回并排阅读',exact:true}).click();
 await page.getByRole('textbox',{name:'页码',exact:true}).fill('84');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');
 await page.getByRole('button',{name:'阅读工具与联网',exact:true}).click();await page.getByRole('checkbox',{name:/网络搜索与网页阅读/}).uncheck();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'选择模型与思考强度'}).click();await page.locator('.model-list button').filter({hasText:'GPT-6.1-Sol'}).click();await page.locator('.effort-options').getByRole('button',{name:'标准',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByTestId('turn-ae36dcf1-e239-4dcf-9bbf-bc618d603b5c').getByRole('button',{name:'追问',exact:true}).click();await page.getByRole('button',{name:'跟随当前页',exact:true}).click();
 await page.getByRole('textbox',{name:'向课件提问'}).fill('我现在看第84页的 eval。请使用课件阅读工具实际打开第84页和第87页的原页图像，对照代码解释 eval [2,4] 与 decimal 42 的关系，再检查空列表、0、[2,4,0] 三种边界情况：它们是否严格互逆？联系我们前面讨论的尾递归，判断这两个函数是否属于尾递归并说明原因。当前关闭联网，只用课件与推导，引用对应页面。');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题',exact:true}).click();const t=await(await response).json();return{id:t.id,page:t.snapshot.page,reply:t.snapshot.replyTurnId,web:t.snapshot.webSearch,model:t.snapshot.model,effort:t.snapshot.reasoningEffort};
}
