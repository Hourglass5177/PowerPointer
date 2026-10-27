async page => {
 const chat=page.getByLabel('对话记录',{exact:true});await chat.evaluate(el=>el.scrollTop=0);const initial=await chat.evaluate(el=>el.scrollTop);await page.waitForTimeout(1800);const after=await chat.evaluate(el=>el.scrollTop);
 await page.getByRole('textbox',{name:'向课件提问'}).fill('下一步想看第84页和第87页的对应关系');await page.reload();await page.getByTestId('turn-510cbf61-28f1-4709-a1cd-2916f9db7346').waitFor();
 const draft=await page.getByRole('textbox',{name:'向课件提问'}).inputValue();await page.getByRole('textbox',{name:'向课件提问'}).fill('');
 return {initialScroll:initial,afterScroll:after,draftRestored:draft,page:await page.getByRole('textbox',{name:'页码',exact:true}).inputValue(),turns:await page.locator('article[data-testid]').count()};
}
