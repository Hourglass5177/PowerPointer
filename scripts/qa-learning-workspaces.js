async page => {
  const check = (v, m) => { if (!v) throw Error(m); };
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = async name => {
    const n = page.getByRole('navigation', { name: '工作区', exact: true });
    if (!await n.isVisible()) await page.getByRole('button', { name: '切换导航', exact: true }).click();
    await n.getByRole('button', { name, exact: true }).click();
  };
  const patch = async action => { const p = page.waitForResponse(r => r.url().includes('/api/courses/') && r.request().method() === 'PATCH'); await action(); check((await p).ok(), 'Course patch'); };
  await page.getByRole('textbox', { name: '搜索课件', exact: true }).fill('03-NFA');
  check(await page.locator('.course-source').count() === 1, 'Material search');
  if (!await page.getByRole('button', { name: '取消当前列表的问答来源', exact: true }).isVisible()) await page.getByText('批量操作', { exact: true }).click();
  await patch(() => page.getByRole('button', { name: '取消当前列表的问答来源', exact: true }).click());
  check(!await page.getByRole('checkbox', { name: '知识来源 03-NFA.ppt', exact: true }).isChecked(), 'Bulk limited to filtered list');
  if (!await page.getByRole('button', { name: '全部参与课程问答', exact: true }).isVisible()) await page.getByText('批量操作', { exact: true }).click();
  await patch(() => page.getByRole('button', { name: '全部参与课程问答', exact: true }).click());
  if (await page.getByRole('button', { name: '全部参与课程问答', exact: true }).isVisible()) await page.getByText('批量操作', { exact: true }).click();
  await page.getByRole('textbox', { name: '搜索课件', exact: true }).fill('');
  await page.locator('.theme-manager > summary').click();
  await page.getByRole('textbox', { name: '新主题名称' }).fill('进阶概念');
  await patch(() => page.getByRole('button', { name: '添加主题', exact: true }).click());
  await page.getByLabel('更多操作 03-NFA.ppt', { exact: true }).click();
  await patch(() => page.getByRole('combobox', { name: '章节主题 03-NFA.ppt' }).selectOption({ label: '进阶概念' }));
  await page.getByRole('textbox', { name: '章节显示名 03-NFA.ppt' }).fill('NFA 与非确定性');
  await patch(() => page.getByRole('textbox', { name: '章节显示名 03-NFA.ppt' }).press('Tab'));
  await patch(() => page.getByRole('button', { name: '上移 03-NFA.ppt' }).click());
  if (await page.getByRole('textbox', { name: '章节显示名 03-NFA.ppt' }).isVisible()) await page.getByLabel('更多操作 03-NFA.ppt', { exact: true }).click();
  check((await page.locator('.course-source').first().innerText()).includes('NFA 与非确定性'), 'Chapter order');
  checks.push('search/filtered bulk source selection/theme/display name/order');
  await page.locator('.theme-manager > summary').click();
  await nav('阅读');
  await page.getByLabel('阅读侧栏', { exact: true }).getByRole('button', { name: '对话', exact: true }).click();
  await page.getByRole('textbox', { name: '页码', exact: true }).fill('12');
  await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
  await page.getByRole('textbox', { name: '向课件提问' }).fill('布局检查草稿');
  for (const width of [1600, 1440, 1024, 520]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['阅读', '总览', '资料', '历史']) {
      await nav(name);
      if (name !== '阅读') await page.locator('.workspace-page[aria-busy=false]').waitFor();
      check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${name} horizontal overflow ${width}`);
      await page.screenshot({ path: `output/playwright/learning-${name}-${width}.png` });
    }
    checks.push(`four workspaces ${width}px`);
  }
  await nav('阅读');
  await page.getByLabel('阅读面板', { exact: true }).getByRole('button', { name: '对话', exact: true }).click();
  check(!await page.getByRole('region', { name: '课件阅读区' }).isVisible(), 'Mobile one panel');
  check(await page.getByRole('textbox', { name: '向课件提问' }).inputValue() === '布局检查草稿', 'Draft across workspaces');
  await page.screenshot({ path: 'output/playwright/learning-mobile-chat.png' });
  await page.getByLabel('阅读面板', { exact: true }).getByRole('button', { name: '笔记', exact: true }).click();
  await page.getByRole('region', { name: '学习笔记', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/learning-mobile-notes.png' });
  checks.push('mobile original/chat/notes');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByLabel('阅读侧栏', { exact: true }).getByRole('button', { name: '对话', exact: true }).click();
  await page.getByRole('button', { name: '展开解释', exact: true }).click();
  check(!await page.getByRole('complementary', { name: '工作区导航' }).isVisible(), 'Expand collapses navigation');
  check((await page.locator('.chat-region').boundingBox()).width === 600, 'Expanded 600px');
  await page.screenshot({ path: 'output/playwright/learning-expanded.png' });
  return { checks, errors };
}
