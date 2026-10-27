async page=>{
 const check=(v,m)=>{if(!v)throw Error(m);};
 await page.getByRole('dialog',{name:'解释：绑定',exact:true}).getByRole('button',{name:'最小化解释窗'}).click();
 await page.getByRole('button',{name:'课程与资料',exact:true}).click();await page.getByRole('combobox',{name:'管理课程'}).selectOption({label:'跨章节与扫描页 · 验收'});
 await page.getByText(/成功 5 \/ 5 页/).waitFor();await page.locator('.knowledge-answer').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/pointer-course-overview.png'});
 await page.getByRole('button',{name:'进入课程阅读 →'}).click();await page.getByRole('heading',{name:'从这一页开始'}).waitFor();
 const courseId=await page.getByRole('combobox',{name:'当前课程'}).inputValue();
 const before=await page.evaluate(id=>localStorage.getItem('lecture-conv-course-'+id),courseId);
 await page.getByRole('combobox',{name:'选择课件'}).selectOption({label:'第二章-动态绑定.pdf'});
 const after=await page.evaluate(id=>localStorage.getItem('lecture-conv-course-'+id),courseId);check(before===after,'chapter switch preserves formal conversation');
 await page.getByRole('button',{name:'提问范围',exact:true}).click();await page.getByRole('button',{name:/课程来源检索/}).click();
 await page.getByRole('textbox',{name:'向课件提问'}).fill('请联系第一章和第二章解释静态作用域、同名重新声明以及 let/local 的可见范围。文件名有“动态绑定”，但请以实际课件内容为准。用三点回答，分别引用两份课件；不要把它们相同的页码当成同一个来源。');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题',exact:true}).click();const turn=await(await response).json();check(turn.id,'turn accepted '+JSON.stringify(turn));
 await page.evaluate(t=>{const s=JSON.parse(localStorage.getItem('pointer-qa'));s.crossConversation=t.conversationId;s.crossTurn=t.id;localStorage.setItem('pointer-qa',JSON.stringify(s));},turn);
 return {conversationUnchanged:before===after,turnId:turn.id,documentIds:turn.snapshot.documentIds,knowledgeRevisionId:turn.snapshot.knowledgeRevisionId};
}
