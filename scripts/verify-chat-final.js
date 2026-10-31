async page => {
 const check=(c,m)=>{if(!c)throw Error(m)};
 await page.reload();await page.getByRole('button',{name:'已连接',exact:true}).waitFor();await page.getByTestId('turn-4f3856b7-5562-4cb7-932f-e2962ae16631').waitFor();
 await page.getByRole('button',{name:'阅读工具与联网'}).click();await page.getByRole('checkbox',{name:/课件工具/}).check();await page.keyboard.press('Escape');
 const article=page.getByTestId('turn-4f3856b7-5562-4cb7-932f-e2962ae16631');
 await article.evaluate(el=>{const host=el.closest('.chat-scroll');host.scrollTop+=el.getBoundingClientRect().top-host.getBoundingClientRect().top-20;});
 await page.getByRole('textbox',{name:'向课件提问'}).focus();await page.screenshot({path:'output/playwright/final-chat-reader.png'});
 await page.getByRole('button',{name:'选择模型与思考强度'}).click();check(await page.getByRole('group',{name:'可用模型'}).getByRole('button').count()>=2,'models loaded');await page.screenshot({path:'output/playwright/chat-model-menu.png'});await page.keyboard.press('Escape');
 const id=await page.evaluate(()=>localStorage.getItem('lecture-conv-'+localStorage.getItem('lecture-last-doc'))), exportResponse=await page.request.get('http://127.0.0.1:17317/api/conversations/'+id+'/export');const md=await exportResponse.text();check(exportResponse.ok()&&md.includes('导数')&&md.includes('MDN')&&!md.includes('](source:'),'markdown export');
 const health=await(await page.request.get('http://127.0.0.1:17317/api/health')).json();check(health.ready,'service healthy');return{ready:true,restoredConversation:id,export:true,modelMenu:true,readingToolsEnabled:true};
}

