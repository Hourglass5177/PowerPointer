async page => {
 await page.getByRole('button',{name:'框选',exact:true}).click();const box=await page.getByTestId('pdf-page').boundingBox();await page.mouse.move(box.x+box.width*.17,box.y+box.height*.33);await page.mouse.down();await page.mouse.move(box.x+box.width*.95,box.y+box.height*.93,{steps:12});await page.mouse.up();
 if(!await page.locator('.draft-context').innerText().then(t=>t.includes('框选区域')))throw Error('crop missing');
 await page.getByRole('button',{name:'提问范围',exact:true}).click();await page.getByRole('button',{name:/当前页 整页图像/}).click();
 await page.getByRole('button',{name:'阅读工具与联网',exact:true}).click();await page.getByRole('checkbox',{name:/课件工具/}).uncheck();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'选择模型与思考强度'}).click();await page.locator('.model-list button').filter({hasText:'GPT-6-Luna'}).click();await page.locator('.effort-options').getByRole('button',{name:'轻量',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'页码',exact:true}).fill('76');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');
 await page.getByRole('textbox',{name:'向课件提问'}).fill('解释刚才框选的第75页代码：pi 后来已经重新声明为3.14159，为什么 area 1.0 仍然是3.14？用不超过三句话解释，并指出截图里结果数字的排印问题。');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题',exact:true}).click();const t=await(await response).json();return{id:t.id,shownPage:await page.getByRole('textbox',{name:'页码',exact:true}).inputValue(),sentPage:t.snapshot.page,rect:t.snapshot.rect,agentTools:t.snapshot.agentTools,web:t.snapshot.webSearch,model:t.snapshot.model};
}
