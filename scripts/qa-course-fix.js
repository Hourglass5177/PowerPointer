async page => {
  const check = (v, message) => { if (!v) throw Error(message); };
  const nav = page.getByRole('navigation', { name: '工作区' });
  const menu = page.getByRole('complementary', { name: '工作区导航' }).locator('summary');
  const select = async name => { await menu.click(); await page.getByRole('button', { name, exact: true }).click(); };
  const ready = () => page.waitForFunction(() => document.querySelector('.page-scroll')?.getAttribute('aria-busy') === 'false');
  await page.getByRole('button', { name: '打开 00-Introduction.ppt', exact: true }).click();
  await ready();
  check((await page.getByRole('region', { name: '课件阅读区' }).innerText()).includes('Introduction'), 'materials open failed');
  await select('函数式编程'); await ready();
  check((await page.getByRole('region', { name: '课件阅读区' }).innerText()).includes('函数式编程'), 'FP course failed');
  await select('计算理论'); await ready();
  check(!(await page.getByRole('region', { name: '课件阅读区' }).innerText()).includes('函数式编程'), 'old course leaked');
  await page.evaluate(() => localStorage.setItem('lecture-last-doc', 'fbff9bae75064cc8172cd4eb3d0eea1b4b7f4194bd99d4710826d868ec0e46f9'));
  await page.reload(); await ready();
  check((await menu.innerText()).includes('计算理论'), 'course lost on reload');
  check(!(await page.getByRole('region', { name: '课件阅读区' }).innerText()).includes('函数式编程'), 'stored old document leaked');
  await nav.getByRole('button', { name: '总览', exact: true }).click();
  await page.getByRole('heading', { name: '计算理论', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.overview-page')?.getAttribute('aria-busy') || document.querySelector('.overview-page')?.getAttribute('aria-busy') === 'false');
  check(await page.getByRole('button', { name: '生成总览', exact: true }).isEnabled(), 'overview disabled');
  await page.screenshot({ path: 'output/playwright/course-fixed-overview.png', fullPage: true });
  await nav.getByRole('button', { name: '资料', exact: true }).click();
  check(await page.getByRole('button', { name: '打开 00-Introduction.ppt', exact: true }).isEnabled(), 'restored source missing');
  console.log(JSON.stringify({ passed: ['资料打开', '课程往返切换', '重载隔离旧课件', '总览可生成', '漏关联资料恢复'], courseSources: await page.getByRole('checkbox', {name: /^知识来源 /}).count() }));
  await page.screenshot({ path: 'output/playwright/course-fixed-materials.png', fullPage: true });
}
