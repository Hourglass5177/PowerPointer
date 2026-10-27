async (page) => {
  await page.reload();
  await page.getByRole("button", { name: "选择 PDF 课件" }).waitFor();
  await page
    .locator("input[type=file]")
    .setInputFiles("E:/大学/AI课件阅读器/samples/微积分入门.pdf");
  await page.getByLabel("页码", { exact: true }).waitFor();
  await page
    .getByText("文本索引 4/5 页", { exact: false })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "跳到第 3 页", exact: true }).click();
  await page.locator(".rendering").waitFor({ state: "hidden" });
  await page.getByTitle("搜索整份课件").click();
  await page.getByLabel("全文搜索", { exact: true }).fill("导数定义");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".search-result").first().waitFor();
  const hit = await page.locator(".search-result").first().innerText();
  const resultPages = await page.locator(".search-result b").allTextContents();
  if (!resultPages.includes("第 1 页")) throw Error("中文定义检索未命中第一页");
  await page.getByTitle("关闭搜索").click();
  await page.getByLabel("提问范围", { exact: true }).selectOption("full");
  await page
    .getByLabel("向课件提问", { exact: true })
    .fill(
      "请找到前文“导数”的定义，解释本页切线斜率为何是6。引用课件来源，不超过200字。",
    );
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/turns") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  const payload = (await request).postDataJSON();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  if (payload.snapshot.page !== 3) throw Error("发送页码未冻结");
  if ((await page.getByLabel("页码", { exact: true }).inputValue()) !== "4")
    throw Error("翻页未生效");
  await page.screenshot({
    path: "output/playwright/sent-and-flipped.png",
    fullPage: false,
  });
  return {
    case: "Chinese retrieval + immediate page flip",
    sentPage: payload.snapshot.page,
    readerPage: 4,
    conversationId: payload.snapshot.conversationId,
    searchHit: hit,
  };
};
