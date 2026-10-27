async page=>{
const check=(v,m)=>{if(!v)throw Error(m)},checks=[];
const ready=()=>page.waitForFunction(()=>document.querySelector('.page-scroll')?.getAttribute('aria-busy')==='false');
const area=page.getByRole('region',{name:'课件阅读区'}),scroll=page.getByTestId('page-scroll'),field=page.getByRole('textbox',{name:'页码',exact:true});
await ready();await field.fill('2');await field.press('Enter');await ready();await area.focus();await page.keyboard.press('0');await ready();let n=await field.inputValue();
for(const props of [{deltaX:100,deltaY:20},{deltaY:120,altKey:true},{deltaY:120,ctrlKey:true},{deltaY:120,metaKey:true},{deltaY:120,shiftKey:true}])await scroll.dispatchEvent('wheel',{...props,bubbles:true,cancelable:true});
check(await field.inputValue()===n,'modified/horizontal wheel');
const chat=page.getByRole('region',{name:'问答窗格'});await chat.dispatchEvent('wheel',{deltaY:200,bubbles:true,cancelable:true});check(await field.inputValue()===n,'chat wheel paged');
if(!await page.getByRole('navigation',{name:'工作区',exact:true}).isVisible())await page.getByRole('button',{name:'切换导航',exact:true}).click();await page.getByRole('button',{name:'页面',exact:true}).click();const thumbs=page.getByLabel('缩略图导航');await thumbs.dispatchEvent('wheel',{deltaY:200,bubbles:true,cancelable:true});check(await field.inputValue()===n,'thumbnail wheel paged');checks.push('horizontal/modifier/chat/thumbnail wheel isolation');
await area.focus();await page.keyboard.press('b');const rect=await page.getByTestId('pdf-page').boundingBox();await page.mouse.move(rect.x+30,rect.y+30);await page.mouse.down();await page.mouse.move(rect.x+130,rect.y+120);await page.mouse.wheel(0,120);check(await field.inputValue()===n,'drag wheel paged');await page.keyboard.press('Escape');await page.mouse.up();check(await page.locator('.selection-box').count()===0,'drag Escape');check(await page.getByRole('button',{name:'选字',exact:true}).getAttribute('aria-pressed')==='true','drag cancel mode');checks.push('wheel during crop and Escape mid-drag');
await area.focus();await page.keyboard.press('b');await page.getByLabel('更多阅读操作',{exact:true}).click();await page.keyboard.press('Escape');check(await page.getByRole('button',{name:'框选',exact:true}).getAttribute('aria-pressed')==='true','Escape cancelled menu and tool');await area.focus();await page.keyboard.press('Escape');check(await page.getByRole('button',{name:'选字',exact:true}).getAttribute('aria-pressed')==='true','second Escape mode');checks.push('one Escape one layer');
return{checks};
}
