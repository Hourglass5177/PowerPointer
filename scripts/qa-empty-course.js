async page => {
  const courses = await (await page.request.get('http://127.0.0.1:4317/api/courses')).json();
  const empty = { ...courses[0], id: 'empty-course-ui-check', name: '空课程回归检查', files: [], documentIds: [], selectedDocumentIds: [], changes: [], root: undefined };
  await page.route('**/api/courses', route => route.fulfill({ json: [...courses, empty] }));
  await page.route('**/api/reading/events', route => route.abort());
  try {
    await page.reload();
    const menu = page.getByRole('complementary', { name: '工作区导航' }).locator('summary');
    await page.waitForFunction(() => document.querySelector('.course-menu summary')?.textContent?.includes('计算理论'));
    await menu.click();
    await page.getByRole('button', { name: '空课程回归检查', exact: true }).click();
    await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name: '阅读', exact: true }).click();
    await page.getByRole('heading', { name: '添加资料', exact: true }).waitFor();
    if (!(await menu.innerText()).includes('空课程回归检查')) throw Error('empty course selection lost');
    if (await page.getByRole('region', { name: '课件阅读区' }).count()) throw Error('empty course displays stale PDF');
    await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('heading', { name: '空课程回归检查', exact: true }).waitFor();
    if (await page.getByRole('button', { name: '生成总览', exact: true }).isEnabled()) throw Error('empty course can generate');
    if (!(await page.getByRole('button', { name: '选择资料', exact: true }).isVisible())) throw Error('missing empty course instruction');
    return { passed: ['空课程保持选中', '不显示其他课程PDF', '无来源时提示选择资料'], productionCoursesUnchanged: true };
  } finally {
    await page.unroute('**/api/courses');
    await page.unroute('**/api/reading/events');
    await page.evaluate(id => localStorage.setItem('pointer-course', id), courses.find(c => c.name === '计算理论').id);
    await page.reload();
  }
}
