async page => {
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  await page.setViewportSize({width:1440,height:900});await page.reload();await page.getByRole('button',{name:'第4页',exact:true}).waitFor();
  if(!(await page.getByRole('complementary',{name:'页面导航'}).count())){await page.getByRole('tab',{name:'视图',exact:true}).click();await page.getByRole('button',{name:'缩略图',exact:true}).click();}
  await page.getByRole('button',{name:'跳到第 4 页',exact:true}).click();
  const nav=page.getByRole('separator',{name:'调整导航宽度'});const nb=await nav.boundingBox();await page.mouse.move(nb.x+2,nb.y+200);await page.mouse.down();await page.mouse.move(nb.x+32,nb.y+200,{steps:6});await page.mouse.up();
  const chat=page.getByRole('separator',{name:'调整问答宽度'});await chat.focus();await chat.press('ArrowLeft');
  const saved=await page.evaluate(()=>({nav:localStorage.getItem('lecture-nav-width'),chat:localStorage.getItem('lecture-chat-width')}));
  await page.reload();await page.getByRole('button',{name:'第4页',exact:true}).waitFor();
  check(await page.getByRole('separator',{name:'调整导航宽度'}).getAttribute('aria-valuenow')===saved.nav,'nav width persistence');
  check(await page.getByRole('separator',{name:'调整问答宽度'}).getAttribute('aria-valuenow')===saved.chat,'chat width persistence');
  await page.getByRole('button',{name:'关闭导航',exact:true}).click();await page.reload();await page.getByRole('button',{name:'第4页',exact:true}).waitFor();check(!(await page.getByRole('complementary',{name:'页面导航'}).count()),'nav collapsed persistence');
  await page.getByRole('tab',{name:'视图',exact:true}).click();await page.getByRole('button',{name:'缩略图',exact:true}).click();
  await page.getByRole('button',{name:'问答窗格',exact:true}).click();check(!(await page.getByRole('region',{name:'问答窗格'}).count()),'chat collapsed');await page.getByRole('button',{name:'问答窗格',exact:true}).click();
  await page.getByRole('button',{name:'适合页面',exact:true}).first().click();
  await page.getByRole('tab',{name:'阅读',exact:true}).click();
  const dimensions=[];
  for(const [name,width,height] of [['1440',1440,900],['1920',1920,1080],['narrow',760,850]]){
    await page.setViewportSize({width,height});
    await page.waitForFunction(()=>{const p=document.querySelector('[data-testid=pdf-page]')?.getBoundingClientRect(),host=document.querySelector('.reader-surface')?.getBoundingClientRect();return p&&host&&!document.querySelector('.rendering')&&p.width<=host.width&&p.height<=host.height;});
    const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,header:document.querySelector('.office-header').getBoundingClientRect().height,canvas:document.querySelector('.reader-surface').getBoundingClientRect().toJSON(),page:document.querySelector('[data-testid=pdf-page]').getBoundingClientRect().toJSON()}));
    check(size.scrollWidth<=width,'no horizontal overflow at '+name);check(size.header<=114,'compact ribbon');
    await page.screenshot({path:`output/playwright/after-${name}.png`});dimensions.push({name,...size});
  }
  check(!(await page.getByRole('region',{name:'问答窗格'}).count()),'narrow reading default');
  await page.getByRole('button',{name:'问答',exact:true}).click();await page.getByRole('region',{name:'问答窗格'}).waitFor();await page.screenshot({path:'output/playwright/after-narrow-chat.png'});await page.keyboard.press('Escape');check(!(await page.getByRole('region',{name:'问答窗格'}).count()),'escape closes drawer');
  await page.getByRole('tab',{name:'视图',exact:true}).click();await page.getByRole('button',{name:'缩略图',exact:true}).click();check(await page.getByRole('complementary',{name:'页面导航'}).isVisible(),'manual narrow navigation');await page.getByRole('button',{name:'关闭导航',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'缩略图',exact:true}).click();
  await page.getByRole('tab',{name:'阅读',exact:true}).click();
  await page.getByRole('button',{name:'已连接',exact:true}).click();await page.getByRole('dialog',{name:'设置'}).waitFor();check(await page.getByRole('button',{name:'关闭设置'}).evaluate(el=>el===document.activeElement),'settings focus');await page.keyboard.press('Shift+Tab');check(await page.getByRole('dialog',{name:'设置'}).evaluate(el=>el.contains(document.activeElement)),'settings focus trap');await page.keyboard.press('Escape');
  await page.getByLabel('会话菜单').click();
  const href=await page.getByRole('link',{name:'导出 Markdown'}).getAttribute('href');const exportResponse=await page.request.get(new URL(href,page.url()).href);const text=await exportResponse.text();check(exportResponse.ok()&&text.includes('幻灯片 第 4 页'),'PPT markdown citations');
  await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'选择课件'}).selectOption({label:'纯扫描 图形.pdf'});await page.getByText('图中口令：枫叶 729 蓝色图形：三角形。').waitFor();
  await page.getByRole('combobox',{name:'选择课件'}).selectOption({label:'微积分 图形验证.pptx'});await page.getByText('银杏 862',{exact:true}).waitFor();
  return {dimensions,widthPersistence:saved,collapsedPersistence:true,narrowDrawer:true,focusTrap:true,export:true,oldConversationPreserved:true};
}
