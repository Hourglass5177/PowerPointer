async page => {
 await page.reload();await page.getByTestId('turn-6225bf7f-cc4c-4ef4-9e1d-2c2a424ee567').getByRole('button',{name:'追问',exact:true}).waitFor();
 await page.getByRole('button',{name:'选择模型与思考强度'}).click();await page.getByRole('button',{name:'选择模型与思考强度'}).click();const toggleStaysOpen=await page.getByRole('dialog',{name:'模型与思考强度'}).isVisible();await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'页码',exact:true}).fill('54');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');await page.getByTestId('turn-6225bf7f-cc4c-4ef4-9e1d-2c2a424ee567').getByRole('button',{name:'追问',exact:true}).click();const before=await page.locator('.reply-banner').count();await page.getByRole('button',{name:'跟随当前页',exact:true}).click();const after=await page.locator('.reply-banner').count();
 if(toggleStaysOpen||before!==1||after!==1)throw Error('Model toggle or cross-page reply regression');
 return{title:await page.title(),modelToggleStaysOpen:toggleStaysOpen,replyBefore:before,replyAfter:after,page:await page.getByRole('textbox',{name:'页码',exact:true}).inputValue()};
}
