async page => {
 await page.getByTestId('turn-ae36dcf1-e239-4dcf-9bbf-bc618d603b5c').getByRole('button',{name:'追问',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'页码',exact:true}).fill('48');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');
 await page.getByRole('button',{name:'阅读工具与联网',exact:true}).click();await page.getByRole('checkbox',{name:/网络搜索与网页阅读/}).check();await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'向课件提问'}).fill('第48页说函数式编程语言“不能处理I/O，不能与外界交互”。这个说法适用于 Standard ML 吗？请实际联网搜索并打开 Standard ML Basis Library 的官方 TextIO 文档核对，给一个很短的 SML 输出例子，区分纯函数的限制和现实语言的能力。引用这一页及你打开的官方网页；不要只凭记忆。');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题',exact:true}).click();const t=await(await response).json();
 return{id:t.id,page:t.snapshot.page,web:t.snapshot.webSearch,model:t.snapshot.model,reply:t.snapshot.replyTurnId};
}
