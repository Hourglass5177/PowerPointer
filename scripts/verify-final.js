async page => {
  await page.reload();
  await page.getByRole('button',{name:'选择 PDF 课件'}).waitFor();
  await page.locator('input[type=file]').setInputFiles('E:/大学/AI课件阅读器/samples/微积分入门.pdf');
  await page.getByText('文本索引 4/5 页',{exact:false}).waitFor({timeout:30000});
  const calculusDoc=await page.getByLabel('选择课件',{exact:true}).inputValue();
  await page.getByRole('button',{name:'跳到第 2 页',exact:true}).click();
  await page.locator('.rendering').waitFor({state:'hidden'});
  const text=await page.locator('.textLayer').innerText();if(!text.includes('2xh+h^2'))throw Error('中文公式示例渲染不完整');
  await page.locator('input[type=file]').setInputFiles('E:/大学/AI课件阅读器/samples/纯扫描 图形.pdf');
  await page.getByText('文本索引 0/1 页',{exact:false}).waitFor({timeout:30000});
  await page.getByRole('heading',{name:'从一个好问题开始'}).waitFor();
  const scanDoc=await page.getByLabel('选择课件',{exact:true}).inputValue();
  const scanConv=await page.getByLabel('选择学习会话',{exact:true}).inputValue();
  await page.getByLabel('向课件提问',{exact:true}).fill('请读取图片中完整的“图中口令”，并说明蓝色图形的形状。只回答图中内容。');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();
  await page.getByLabel('选择课件',{exact:true}).selectOption(calculusDoc);
  await page.getByLabel('页码',{exact:true}).fill('3');
  return {calculusDoc,scanDoc,scanConv,calculusPage:3};
}
