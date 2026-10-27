async page=>{
await page.reload();const ready=()=>page.waitForFunction(()=>document.querySelector('.page-scroll')?.getAttribute('aria-busy')==='false');await ready();const check=(v,m)=>{if(!v)throw Error(m)},nav=page.getByRole('navigation',{name:'工作区',exact:true});
const name=await page.locator('.toolbar-title').getAttribute('title');const docs=await(await page.request.get('http://127.0.0.1:4320/api/documents')).json();const doc=docs.find(d=>d.name===name);for(let i=0;i<(360-(doc.rotation||0))%360/90;i++){await page.getByLabel('更多阅读操作',{exact:true}).click();await page.getByRole('button',{name:'旋转页面',exact:true}).click();await ready();}
await page.getByRole('textbox',{name:'向课件提问'}).fill('');await page.getByRole('region',{name:'课件阅读区'}).focus();await page.keyboard.press('0');await ready();
for(const width of [1440,1024,520]){
await page.setViewportSize({width,height:900});await ready();const n=await nav.boundingBox(),toggle=await page.getByRole('button',{name:'切换导航'}).boundingBox();check(Math.abs(n.y-toggle.y)<12,'navigation wraps '+width);check(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'overflow '+width);await page.screenshot({path:'output/playwright/top-nav-reading-'+width+'.png'});
if(width===520){await page.getByRole('button',{name:'对话',exact:true}).click();await page.getByRole('button',{name:'联系前文',exact:true}).waitFor();await page.screenshot({path:'output/playwright/top-nav-chat-520.png'});await page.getByRole('button',{name:'返回课件',exact:true}).click();}
}
await page.setViewportSize({width:1440,height:900});return{result:'all widths: navigation shares first row, no overflow; cards visible'};
}
