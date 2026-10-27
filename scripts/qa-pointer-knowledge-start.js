async page=>{
 await page.getByRole('textbox',{name:'向课件提问'}).fill('现在在右侧增加一个新的未来暗号：“紫色企鹅”。只回复已记住。');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题',exact:true}).click();const future=await(await response).json();if(!future.id)throw Error(JSON.stringify(future));
 await page.getByRole('button',{name:'课程与资料',exact:true}).click();
 await page.getByRole('combobox',{name:'管理课程'}).selectOption({label:'跨章节与扫描页 · 验收'});
 await page.getByText('3 份资料 · 3 份已选来源 · 5 页',{exact:true}).waitFor();
 const build=page.waitForResponse(r=>r.url().endsWith('/knowledge')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'建立整体理解 · 推荐',exact:true}).click();const job=await(await build).json();if(!job.id)throw Error(JSON.stringify(job));
 await page.screenshot({path:'output/playwright/pointer-knowledge-progress.png'});
 await page.evaluate(v=>{const s=JSON.parse(localStorage.getItem('pointer-qa'));Object.assign(s,v);localStorage.setItem('pointer-qa',JSON.stringify(s));},{futureTurn:future.id,knowledgeId:job.id,knowledgeCourseId:job.courseId});
 await page.getByRole('button',{name:'关闭课程与资料'}).click();
 return{futureTurn:future.id,knowledgeId:job.id,total:job.total};
}
