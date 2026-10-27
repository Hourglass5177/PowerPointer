import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.ts";
import { search } from "../server/search.ts";
import { Codex } from "../server/codex.ts";
import { openPdf, renderPage } from "../server/pdf.ts";
import { normalizedRect } from "../shared/geometry.ts";
import { loadImage, createCanvas } from "@napi-rs/canvas";

test("中文跨页 BM25 找到定义；无文字页不伪造命中", () => {
  const pages = [
    { page: 1, text: "导数的定义是函数在一点的瞬时变化率。" },
    { page: 2, text: "积分可用于计算平面图形面积。" },
    { page: 3, text: "" },
  ];
  assert.equal(search(pages, "瞬时变化率是什么")[0].page, 1);
  assert.deepEqual(search(pages, "热力学"), []);
});
test("SQLite 重开保持会话归属与不可变问题快照", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lecture-store-"));
  let s = new Store(dir);
  try {
    const snapshot = { documentId: "doc1", page: 2 };
    s.put("turn", { id: "t1", conversationId: "c1", snapshot });
    snapshot.page = 5;
    s.put("turn", {
      id: "t2",
      conversationId: "c2",
      snapshot: { documentId: "doc2", page: 1 },
    });
    s.close();
    s = new Store(dir);
    assert.equal(s.get<any>("turn", "t1").snapshot.page, 2);
    assert.equal(
      s.all<any>("turn").filter((t) => t.conversationId === "c1").length,
      1,
    );
  } finally {
    s.close();
    assert.ok(
      path.resolve(dir).startsWith(path.join(os.tmpdir(), "lecture-store-")),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});
test("PDF 旋转、缩放和 DPI/滚动偏移逆变换保留同一选区", async () => {
  const pdf = await openPdf(path.resolve("samples/纯扫描 图形.pdf"));
  try {
    const page = await pdf.getPage(1),
      region = [70, 180, 230, 315];
    for (const rotation of [0, 90, 180, 270])
      for (const scale of [0.75, 2])
        for (const dpr of [1, 1.5, 2]) {
          const vp = page.getViewport({ scale, rotation });
          const coords = vp.convertToViewportRectangle(region);
          const left = 42 - 120,
            top = 83 - 240;
          const cssA = [
              (coords[0] * dpr) / dpr + left,
              (coords[1] * dpr) / dpr + top,
            ],
            cssB = [coords[2] + left, coords[3] + top];
          const actual = normalizedRect(
            vp.convertToPdfPoint(cssA[0] - left, cssA[1] - top),
            vp.convertToPdfPoint(cssB[0] - left, cssB[1] - top),
          );
          actual.forEach((v, i) => assert.ok(Math.abs(v - region[i]) < 1e-8));
        }
  } finally {
    await pdf.destroy();
  }
});
test("后端裁图在四种旋转下均截到同一个红圆；扫描页确实无文字", async () => {
  const filename = path.resolve("samples/纯扫描 图形.pdf"),
    pdf = await openPdf(filename);
  try {
    const text = await (await pdf.getPage(1)).getTextContent();
    assert.equal(text.items.length, 0);
  } finally {
    await pdf.destroy();
  }
  for (const rotation of [0, 90, 180, 270]) {
    const buffer = await renderPage(
      filename,
      1,
      rotation,
      [75, 190, 205, 315],
      1200,
    );
    const img = await loadImage(buffer),
      c = createCanvas(img.width, img.height),
      x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, img.width, img.height).data;
    let red = 0,
      blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 150 && data[i + 1] < 110 && data[i + 2] < 110) red++;
      if (data[i + 2] > 130 && data[i] < 100) blue++;
    }
    assert.ok(red / (data.length / 4) > 0.4);
    assert.equal(blue, 0);
  }
});
class FakeCodex extends Codex {
  calls: { method: string; params: any }[] = [];
  override async connect() {}
  override async rpc(method: string, params: any = {}) {
    this.calls.push({ method, params });
    if (method === "turn/start") {
      queueMicrotask(() =>
        this.emit("notification", "turn/started", {
          threadId: "t",
          turn: { id: "r" },
        }),
      );
      return { turn: { id: "r" } };
    }
    if (method === "turn/interrupt") {
      queueMicrotask(() =>
        this.emit("notification", "turn/completed", {
          threadId: "t",
          turn: { id: "r", status: "interrupted", items: [] },
        }),
      );
      return {};
    }
    return {};
  }
}
test("受控协议：流式后额度失败仍为失败，不能把收到文本当作完成", async () => {
  const ai = new FakeCodex(path.resolve("output/unit"));
  const events: any[] = [];
  const p = ai.run("t", "问题", [], (e) => events.push(e));
  await new Promise((r) => setImmediate(r));
  ai.emit("notification", "item/agentMessage/delta", {
    threadId: "other",
    delta: "wrong",
  });
  ai.emit("notification", "item/agentMessage/delta", {
    threadId: "t",
    delta: "部分回答",
  });
  ai.emit("notification", "turn/completed", {
    threadId: "t",
    turn: {
      id: "r",
      status: "failed",
      error: { message: "usage_limit_reached" },
      items: [],
    },
  });
  await assert.rejects(p, /usage_limit_reached/);
  assert.equal(events.find((e) => e.text)?.text, "部分回答");
});
test("受控协议：取消等待 interrupted，连接断开拒绝成功，均不重发推理", async () => {
  const ai = new FakeCodex(path.resolve("output/unit")),
    controller = new AbortController();
  const p = ai.run("t", "问题", [], () => {}, controller.signal);
  await new Promise((r) => setImmediate(r));
  controller.abort();
  assert.equal((await p).status, "interrupted");
  assert.equal(ai.calls.filter((c) => c.method === "turn/start").length, 1);
  const ai2 = new FakeCodex(path.resolve("output/unit"));
  const p2 = ai2.run("t", "问题", [], () => {});
  await new Promise((r) => setImmediate(r));
  ai2.emit("disconnect", Error("连接断开"));
  await assert.rejects(p2, /连接断开/);
  assert.equal(ai2.calls.length, 1);
});

test("受控协议：只读工具保留真实来源，网页结果保留链接，最终答案排除过程说明", async () => {
  const ai = new FakeCodex(path.resolve("output/unit")),
    events: any[] = [];
  const promise = ai.run("t", "问题", [], (e) => events.push(e), undefined, {
    agentTools: true,
    webSearch: true,
    reader: {
      documentId: "a".repeat(64),
      page: 1,
      scope: "page",
      extraPages: [],
    },
  });
  await new Promise((r) => setImmediate(r));
  ai.emit("notification", "item/completed", {
    threadId: "t",
    item: {
      id: "m",
      type: "mcpToolCall",
      server: "lecture_reader",
      tool: "search_course",
      arguments: { query: "导数" },
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              sources: [
                {
                  id: "valid",
                  documentId: "a".repeat(64),
                  page: 1,
                  text: "真实材料",
                },
                {
                  id: "wrong",
                  documentId: "b".repeat(64),
                  page: 2,
                  text: "不应出现",
                },
              ],
            }),
          },
        ],
      },
    },
  });
  ai.emit("notification", "item/completed", {
    threadId: "t",
    item: {
      id: "w",
      type: "webSearch",
      action: { type: "other" },
      results: [
        { url: "https://example.com/reference", title: "实际网页" },
        { url: "javascript:alert(1)", title: "无效" },
      ],
    },
  });
  ai.emit("notification", "turn/completed", {
    threadId: "t",
    turn: {
      id: "r",
      status: "completed",
      items: [
        { type: "agentMessage", phase: "commentary", text: "正在查阅" },
        { type: "agentMessage", phase: "final_answer", text: "正式回答" },
      ],
    },
  });
  assert.equal((await promise).text, "正式回答");
  assert.equal(events.find((e) => e.sources)?.sources.length, 1);
  const web = events.find((e) => e.activity?.kind === "web").activity;
  assert.equal(web.title, "查阅网页");
  assert.deepEqual(web.links, [
    { title: "实际网页", url: "https://example.com/reference" },
  ]);
});
