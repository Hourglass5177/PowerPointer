async page => {
 const check=(c,m)=>{if(!c)throw Error(m)};
 const ctx=await page.context().browser().newContext({viewport:{width:1440,height:900},deviceScaleFactor:1.5});const high=await ctx.newPage();let captured;
 try{
 await high.goto(page.url());await high.getByRole('combobox',{name:'选择课件'}).selectOption({label:'微积分 图形验证.pptx'});await high.getByRole('button',{name:'跳到第 4 页',exact:true}).click();await high.getByRole('button',{name:'旋转',exact:true}).click();
 await high.getByRole('slider',{name:'缩放滑块'}).evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'125');el.dispatchEvent(new Event('input',{bubbles:true}));});
 await high.waitForFunction(()=>{const p=document.querySelector('[data-testid=pdf-page]');return p&&!document.querySelector('.rendering')&&Math.abs(p.getBoundingClientRect().width-675)<1;});
 await high.getByTestId('page-scroll').evaluate(el=>el.scrollTop=130);await high.getByRole('button',{name:'框选',exact:true}).click();const b=await high.getByTestId('pdf-page').boundingBox(),s=b.width/540;
 await high.mouse.move(b.x+185*s,b.y+125*s);await high.mouse.down();await high.mouse.move(b.x+295*s,b.y+230*s,{steps:10});await high.mouse.up();
 check(await high.getByRole('textbox',{name:'向课件提问'}).evaluate(el=>el===document.activeElement),'crop auto-focus');
 await high.getByRole('button',{name:'跳到第 2 页',exact:true}).click();
 await high.route('**/api/turns',async route=>{captured=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:'{"error":"受控DPR验证"}'});});await high.getByRole('textbox',{name:'向课件提问'}).fill('仅验证');await high.getByRole('textbox',{name:'向课件提问'}).press('Control+Enter');await high.getByRole('alert').waitFor();
 check(captured.snapshot.rect.every((v,i)=>Math.abs(v-[125,185,230,295][i])<.01),'DPR crop');check(captured.snapshot.page===4&&captured.snapshot.rotation===90,'pin survives page change');await high.screenshot({path:'output/playwright/chat-hidpi.png'});await high.unroute('**/api/turns');
 for(let i=0;i<3;i++)await high.getByRole('button',{name:'旋转',exact:true}).click();await high.getByRole('button',{name:'适合页面',exact:true}).click();await high.waitForFunction(()=>!document.querySelector('.rendering'));
 }finally{await ctx.close();}
 await page.reload();await page.getByRole('textbox',{name:'向课件提问'}).waitFor();await page.getByRole('button',{name:'跳到第 1 页',exact:true}).click();
 await page.getByRole('button',{name:'展开问答',exact:true}).click();check(await page.locator('.reader-surface').evaluate(el=>el.inert),'expanded background inert');await page.keyboard.press('Escape');
 const dimensions=[];for(const [w,h]of[[1440,900],[1920,1080],[760,850]]){await page.setViewportSize({width:w,height:h});await page.waitForFunction(()=>!document.querySelector('.rendering'));dimensions.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})));if(w===760)await page.getByRole('button',{name:'问答',exact:true}).click();await page.screenshot({path:`output/playwright/chat-${w}.png`});}
 check(dimensions.every(x=>!x.overflow),'no overflow');await page.setViewportSize({width:1440,height:900});
 return {crop:captured.snapshot.rect,pinned:true,dimensions,expandedFocus:true};
}
