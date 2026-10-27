async (page) => {
  const complete = page.locator(".turn").last();
  if ((await complete.locator(".turn-state").innerText()) !== "完成")
    throw Error("上轮尚未完成");
  const cite = complete
    .locator(".citation")
    .filter({ hasText: "第1页" })
    .first();
  await cite.click();
  if ((await page.getByLabel("页码", { exact: true }).inputValue()) !== "1")
    throw Error("引用跳转错误");
  await page.getByRole("button", { name: "跳到第 4 页", exact: true }).click();
  await page.getByLabel("缩放", { exact: true }).selectOption("1.5");
  await page.locator(".rendering").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "框选提问", exact: true }).click();
  await page.locator(".page-scroll").evaluate((el) => {
    el.scrollTop = 130;
    el.scrollLeft = 50;
  });
  const b = await page.locator("[data-testid=pdf-page]").boundingBox();
  // Known sample PDF coordinates [75,190,205,315]; convert from PDF bottom-left to CSS top-left.
  await page.mouse.move(b.x + 75 * 1.5, b.y + (540 - 315) * 1.5);
  await page.mouse.down();
  await page.mouse.move(b.x + 205 * 1.5, b.y + (540 - 190) * 1.5, {
    steps: 10,
  });
  await page.mouse.up();
  await page.locator(".attached-context").click();
  const crop = page.getByAltText("框选裁图预览", { exact: true });
  await crop.waitFor();
  await crop.evaluate(async (img) => {
    if (!img.complete)
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
  });
  const src = await crop.getAttribute("src");
  const selected = JSON.parse(
    new URL(src, "http://127.0.0.1:4317").searchParams.get("rect"),
  );
  [75, 190, 205, 315].forEach((v, i) => {
    if (Math.abs(selected[i] - v) > 2) throw Error("框选坐标不匹配");
  });
  await page.getByLabel("提问范围", { exact: true }).selectOption("page");
  await page
    .getByLabel("向课件提问", { exact: true })
    .fill(
      "只描述第二张附件（框选裁图）内的图形颜色、形状和数量。不要将整页其他图形算入。50字以内。",
    );
  await page.screenshot({
    path: "output/playwright/crop-150-percent.png",
    fullPage: false,
  });
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/turns") && r.method() === "POST",
  );
  await page.getByLabel("向课件提问", { exact: true }).press("Control+Enter");
  const payload = (await request).postDataJSON();
  await page.getByRole("button", { name: "跳到第 2 页", exact: true }).click();
  return {
    case: "citation jump + 150% selection with scroll + CtrlEnter",
    selection: payload.snapshot.rect,
    page: payload.snapshot.page,
    readerPage: 2,
    previewUrl: src,
  };
};
