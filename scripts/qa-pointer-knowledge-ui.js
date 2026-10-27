async page=>{
await page.getByRole('combobox',{name:'管理课程'}).selectOption('');await page.getByRole('heading',{name:'先为课件创建一门课程'}).waitFor();await page.screenshot({path:'output/playwright/pointer-knowledge-empty.png'});
await page.getByRole('textbox',{name:'新课程名称'}).fill('入口验收 · 不调用模型');const created=page.waitForResponse(r=>r.url().endsWith('/api/courses')&&r.request().method()==='POST');await page.getByRole('button',{name:'新建课程',exact:true}).click();const c=await(await created).json();await page.getByRole('heading',{name:'从每一页，连接到整门课'}).waitFor();
if(c.selectedDocumentIds.length!==1)throw Error('Current document not included');
await page.getByRole('button',{name:'调整来源 →'}).click();await page.getByRole('heading',{name:'知识来源',exact:true}).waitFor();await page.getByRole('button',{name:/整体理解.*前往/}).click();
await page.getByText('知识联系如何形成，提问时怎样使用？',{exact:true}).click();await page.getByText(/尚未形成可编辑的节点连线图/).waitFor();
await page.setViewportSize({width:520,height:850});await page.screenshot({path:'output/playwright/pointer-knowledge-narrow.png'});
const bounds=await page.getByRole('dialog',{name:'课程与资料'}).boundingBox();if(bounds.x<0||bounds.x+bounds.width>520)throw Error('Panel outside screen');
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Horizontal overflow');await page.getByRole('button',{name:'关闭课程与资料'}).click();await page.screenshot({path:'output/playwright/pointer-toolbar-narrow.png'});
await page.setViewportSize({width:1440,height:900});return{course:c.id,autoIncluded:1,emptyGuide:true,narrow:true};
}
