async (page) => {
  if (
    (await page.locator(".turn").last().locator(".turn-state").innerText()) !==
    "完成"
  )
    throw Error("框选问答未完成");
  const cropAnswer = await page
    .locator(".turn")
    .last()
    .locator(".answer")
    .innerText();
  if (!cropAnswer.includes("1") || !cropAnswer.includes("红"))
    throw Error("视觉裁图回答不正确");
  await page.getByRole("button", { name: "框选中", exact: true }).click();
  await page.getByRole("button", { name: "跳到第 1 页", exact: true }).click();
  await page.getByLabel("缩放", { exact: true }).selectOption("0");
  await page.locator(".rendering").waitFor({ state: "hidden" });
  const line = page
    .locator(".textLayer span")
    .filter({ hasText: "导数的定义" })
    .first();
  await line.waitFor();
  const b = await line.boundingBox();
  await page.mouse.move(b.x + 1, b.y + b.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height * 0.6, { steps: 12 });
  await page.mouse.up();
  await page
    .getByLabel("向课件提问", { exact: true })
    .fill("选中文字持久化测试（不发送）");
  const contextText = await page.locator(".attached-context").innerText();
  if (!contextText.includes("选中文字"))
    throw Error("文字选区在输入框聚焦后丢失");
  const firstDoc = await page
    .getByLabel("选择课件", { exact: true })
    .inputValue();
  const firstConv = await page
    .getByLabel("选择学习会话", { exact: true })
    .inputValue();
  await page
    .locator("input[type=file]")
    .setInputFiles("E:/大学/AI课件阅读器/samples/纯扫描 图形.pdf");
  await page
    .getByText("文本索引 0/1 页", { exact: false })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("heading", { name: "从一个好问题开始", exact: true })
    .waitFor();
  if (await page.locator(".turn").count()) throw Error("切换文档混入旧会话");
  const scanDoc = await page
    .getByLabel("选择课件", { exact: true })
    .inputValue();
  const scanConv = await page
    .getByLabel("选择学习会话", { exact: true })
    .inputValue();
  if (firstConv === scanConv) throw Error("两份课件复用了同一会话");
  await page
    .getByLabel("向课件提问", { exact: true })
    .fill("图片里的口令是什么？蓝色图形是什么形状？只回答图中内容。");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/turns") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  const payload = (await request).postDataJSON();
  await page.getByLabel("选择课件", { exact: true }).selectOption(firstDoc);
  await page
    .getByLabel("选择学习会话", { exact: true })
    .selectOption(firstConv);
  await page.locator(".turn").last().waitFor();
  if (
    (await page.locator(".chat-scroll").innerText()).includes(
      "图片里的口令是什么",
    )
  )
    throw Error("回复归属串文档");
  return {
    case: "retained text selection + image-only PDF + document switch during generation",
    firstDoc,
    firstConv,
    scanDoc,
    scanConv,
    payload,
    selectionRetained: true,
  };
};
