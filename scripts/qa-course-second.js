async page => {
 await page.getByRole('button',{name:'选择模型与思考强度'}).click();
 await page.locator('.model-list button').filter({hasText:'GPT-6-Luna'}).click();
 await page.locator('.effort-options').getByRole('button',{name:'标准',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'提问范围',exact:true}).click();await page.getByRole('button',{name:/整份课件检索 按问题/}).click();
 await page.getByRole('textbox',{name:'向课件提问'}).fill('接着刚才的尾递归问题，我翻到第54页了。请读这一页，比较两个 ML sum 写法与前面 C 的累加器版本：用列表 [3,4,5] 展开关键步骤，指出哪个是尾递归，并说明为什么结果相同却有不同的栈行为。保留我们上一轮讨论的优化前提，引用课件页。');
 await page.getByRole('button',{name:'发送问题',exact:true}).click();
 return {model:await page.locator('.model-trigger').innerText(),reply:await page.locator('.reply-banner').count(),turns:await page.locator('article[data-testid]').count()};
}
