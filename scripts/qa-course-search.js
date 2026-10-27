async page => {
 await page.getByRole('button',{name:'搜索',exact:true}).click();const start=Date.now();await page.getByRole('textbox',{name:'全文搜索',exact:true}).fill('静态作用域');await page.getByRole('textbox',{name:'全文搜索',exact:true}).press('Enter');await page.locator('.search-result').first().waitFor();const results=await page.locator('.search-result > button').allTextContents(),ms=Date.now()-start;
 await page.getByRole('button',{name:'关闭导航',exact:true}).click();await page.getByRole('textbox',{name:'页码',exact:true}).fill('75');await page.getByRole('textbox',{name:'页码',exact:true}).press('Enter');await page.locator('.rendering').waitFor({state:'hidden'});
 return{searchMs:ms,results,text:await page.locator('.textLayer').innerText()};
}
