import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.ts";
import { ChatService } from "../server/chat.ts";
import { DraftStore } from "../shared/drafts.ts";
import { sourceMap, citedSources, portableAnswer } from "../shared/chat.ts";
import { ReadTools } from "../server/reader-tools.ts";
import type {
  Conversation,
  Document,
  QuestionSnapshot,
  Turn,
} from "../shared/types.ts";

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lecture-chat-")),
    store = new Store(dir);
  const doc: Document = {
    id: "a".repeat(64),
    name: "验证.pdf",
    pages: 5,
    indexedPages: 4,
    indexStatus: "ready",
    page: 1,
    rotation: 0,
    zoom: 1,
    createdAt: "2026-10-01",
  };
  const c: Conversation = {
    id: randomUUID(),
    documentId: doc.id,
    title: "新会话",
    model: "test-vision",
    threadId: "parent-thread",
    createdAt: "2026-10-01",
  };
  store.put("document", doc);
  store.put("conversation", c);
  const calls: any[] = [],
    executions: Turn[] = [];
  const ai = {
    thread: async () => "fresh",
    fork: async (...args: any[]) => {
      calls.push(args);
      await new Promise((r) => setTimeout(r, 5));
      return "fork-thread";
    },
    readTurn: async (_tid: string, _id: string): Promise<any> => undefined,
  };
  const service = new ChatService(
    store,
    ai,
    (t) => store.put("turn", t),
    async (t) => {
      executions.push(structuredClone(t));
    },
  );
  const snapshot: Omit<QuestionSnapshot, "images" | "sources"> = {
    documentId: doc.id,
    conversationId: c.id,
    page: 2,
    rotation: 90,
    selectedText: "原始摘录",
    scope: "page",
    extraPages: [],
    answerLength: "detailed",
  };
  const add = (question: string) => {
    const t = service.create(question, snapshot, randomUUID());
    t.state = "completed";
    t.threadTurnId = `remote-${t.id}`;
    t.answer = question + "的回答";
    t.snapshot.sources = [
      { id: `source-${t.id}`, documentId: doc.id, page: 2, text: "资料" },
    ];
    t.snapshot.images = [`${t.id}-0.png`];
    store.put("turn", t);
    return t;
  };
  return {
    dir,
    store,
    doc,
    c,
    ai,
    service,
    snapshot,
    add,
    calls,
    executions,
    close: () => {
      store.close();
      assert.ok(dir.startsWith(path.join(os.tmpdir(), "lecture-chat-")));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("发送幂等、跨会话追问拒绝，重复请求不重复生成", () => {
  const f = fixture();
  try {
    const id = randomUUID(),
      t = f.service.create("原问题", f.snapshot, id);
    assert.equal(f.service.create("原问题", f.snapshot, id).id, t.id);
    assert.equal(f.executions.length, 1);
    assert.throws(
      () => f.service.create("改过的问题", f.snapshot, id),
      /内容不一致/,
    );
    t.state = "completed";
    f.store.put("turn", t);
    assert.throws(
      () =>
        f.service.create("错误追问", {
          ...f.snapshot,
          replyTurnId: randomUUID(),
        }),
      /追问目标/,
    );
    assert.equal(f.store.conversation(f.c.id)?.title, "原问题");
  } finally {
    f.close();
  }
});

test("跨服务分支只复制本地前缀，不把远端线程交给其他服务", async () => {
  const f = fixture();
  try {
    const first = f.add("前缀背景"), target = f.add("要改的问题"); f.add("未来答案");
    first.connectionId = "codex"; f.store.put("turn", first);
    const next = await f.service.branch(target.id, "改写", randomUUID(), { connectionId: "native-example", model: "api-model", textOnly: true });
    assert.equal(f.calls.length, 0);
    assert.equal(f.store.conversation(next.conversationId)?.threadId, undefined);
    assert.equal(next.snapshot.connectionId, "native-example");
    assert.equal(next.snapshot.aiContext, undefined);
    assert.deepEqual(f.service.turns(next.conversationId).map(t => t.question), ["前缀背景", "改写"]);
    assert.equal(f.service.turns(f.c.id).length, 3);
  } finally { f.close(); }
});
test("分支排除目标轮与未来讨论，复制历史保留来源并保持原会话不变", async () => {
  const f = fixture();
  try {
    const first = f.add("保留索引"),
      target = f.add("需要修改"),
      future = f.add("不应进入分支的口令");
    const original = JSON.stringify(f.service.turns(f.c.id)),
      id = randomUUID();
    const [a, b] = await Promise.all([
      f.service.branch(target.id, "修改后的问题", id),
      f.service.branch(target.id, "修改后的问题", id),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0], [
      "test-vision",
      "parent-thread",
      target.threadTurnId,
      first.threadTurnId,
    ]);
    assert.equal(JSON.stringify(f.service.turns(f.c.id)), original);
    const child = f.service.turns(a.conversationId);
    assert.equal(child.length, 2);
    assert.equal(child[0].question, first.question);
    assert.ok(!child.some((t) => t.question === future.question));
    assert.deepEqual(child[0].snapshot.sources, first.snapshot.sources);
    assert.deepEqual(a.snapshot.images, target.snapshot.images);
    assert.equal(a.snapshot.page, 2);
    assert.equal(a.snapshot.rotation, 90);
    assert.equal(
      f.store.conversation(a.conversationId)?.parentConversationId,
      f.c.id,
    );
    assert.equal(
      (await f.service.branch(target.id, "修改后的问题", id)).id,
      a.id,
    );
  } finally {
    f.close();
  }
});
test("首轮分支创建空模型历史；未知结果先核对，完成时不重新推理", async () => {
  const f = fixture();
  try {
    const first = f.add("第一轮"),
      branch = await f.service.branch(first.id);
    assert.equal(f.calls.length, 0);
    assert.equal(
      f.store.conversation(branch.conversationId)?.threadId,
      undefined,
    );
    assert.equal(f.service.turns(branch.conversationId).length, 1);
    first.state = "unknown";
    f.store.put("turn", first);
    f.ai.readTurn = async () => ({
      status: "completed",
      items: [{ type: "agentMessage", text: "恢复到已完成的真实回答" }],
    });
    const before = f.executions.length,
      recovered = await f.service.retry(first.id);
    assert.equal(recovered.state, "completed");
    assert.equal(f.executions.length, before);
    assert.equal(recovered.id, first.id);
  } finally {
    f.close();
  }
});
test("分支可更换模型与工具设置，页码、裁图及原回答保持不变", async () => {
  const f = fixture();
  try {
    const first = f.add("原问题");
    first.snapshot.model = "old";
    first.snapshot.reasoningEffort = "ultra";
    f.store.put("turn", first);
    const child = await f.service.branch(first.id, "换模型解释", randomUUID(), {
      model: "new",
      agentTools: false,
      webSearch: true,
      answerLength: "short",
    });
    assert.equal(child.snapshot.model, "new");
    assert.equal(child.snapshot.reasoningEffort, undefined);
    assert.equal(child.snapshot.webSearch, true);
    assert.equal(child.snapshot.agentTools, false);
    assert.equal(child.snapshot.page, first.snapshot.page);
    assert.deepEqual(child.snapshot.images, first.snapshot.images);
    assert.equal(f.store.turn(first.id)?.snapshot.model, "old");
  } finally {
    f.close();
  }
});
test("归档、搜索与重命名保留模型会话；失败分支不改写原记录", async () => {
  const f = fixture();
  try {
    const t = f.add("傅里叶与频率"),
      next = f.add("目标");
    f.service.patch(f.c.id, {
      title: "信号学习",
      pinned: true,
      archived: true,
    });
    assert.equal(f.service.list(f.doc.id, "频率")[0].id, f.c.id);
    assert.equal(f.store.conversation(f.c.id)?.threadId, "parent-thread");
    assert.throws(() => f.service.create("新问题", f.snapshot), /归档/);
    f.service.patch(f.c.id, { archived: false });
    f.ai.fork = async () => {
      throw Error("受控分支失败");
    };
    const before = JSON.stringify(f.service.turns(f.c.id));
    await assert.rejects(f.service.branch(next.id), /受控分支失败/);
    assert.equal(JSON.stringify(f.service.turns(f.c.id)), before);
    assert.equal(f.store.all<Conversation>("conversation").length, 1);
    assert.ok(t.threadTurnId);
  } finally {
    f.close();
  }
});
test("草稿按会话隔离，发送返回不会清掉新输入；提交后解除旧选区及分支", () => {
  const memory = new Map<string, string>(),
    storage = {
      getItem: (k: string) => memory.get(k) || null,
      setItem: (k: string, v: string) => {
        memory.set(k, v);
      },
    };
  const drafts = new DraftStore(storage);
  const sent = drafts.update("doc1-c1", {
    question: "旧问题",
    pinned: { page: 3, rotation: 90 },
    rect: [1, 2, 3, 4],
    editTurnId: "old",
    model: "m",
    reasoningEffort: "high",
    webSearch: true,
  });
  drafts.update("doc1-c1", { question: "发送期间写下的新问题" });
  assert.equal(drafts.clearSubmitted("doc1-c1", sent.revision), false);
  drafts.update("doc1-c2", { question: "另一会话" });
  assert.equal(
    new DraftStore(storage).get("doc1-c1").question,
    "发送期间写下的新问题",
  );
  assert.equal(drafts.get("doc1-c2").question, "另一会话");
  const now = drafts.get("doc1-c1");
  assert.equal(drafts.clearSubmitted("doc1-c1", now.revision), true);
  const clean = drafts.get("doc1-c1");
  assert.equal(clean.question, "");
  assert.equal(clean.pinned, undefined);
  assert.equal(clean.editTurnId, undefined);
  assert.equal(clean.model, "m");
  assert.equal(clean.webSearch, true);
});
test("引用只显示实际有效来源，保留历史工具来源及可复制公式", () => {
  const f = fixture();
  try {
    const t = f.add("问答");
    t.toolSources = [
      {
        id: "tool-1",
        documentId: f.doc.id,
        page: 4,
        text: "工具实际读到的文字",
      },
    ];
    const sources = sourceMap([t], f.doc.id),
      answer = "$x^2$ [第4页](source:tool-1) [假来源](source:missing)";
    assert.equal(citedSources(answer, sources).length, 1);
    assert.match(
      portableAnswer(answer, sources, f.doc.name),
      /\$x\^2\$.*验证.pdf，第 4 页/,
    );
    assert.equal(sourceMap([t], "other-doc").size, 0);
  } finally {
    f.close();
  }
});
test("只读课件工具遵守页码范围，真实图像读取不允许任意路径或未知工具", async () => {
  const f = fixture();
  let tools: ReadTools | undefined;
  try {
    mkdirSync(path.join(f.dir, "pdfs"));
    copyFileSync(
      "samples/微积分入门.pdf",
      path.join(f.dir, "pdfs", f.doc.id + ".pdf"),
    );
    f.store.page(f.doc.id, 1, "导数是瞬时变化率");
    f.store.page(f.doc.id, 4, "");
    tools = new ReadTools(f.dir, {
      documentId: f.doc.id,
      page: 1,
      scope: "page",
      extraPages: [],
    });
    const result = await tools.call("search_course", { query: "瞬时变化率" });
    assert.equal(
      JSON.parse((result.content[0] as any).text).sources[0].page,
      1,
    );
    await assert.rejects(tools.call("read_pages", { pages: [4] }), /范围/);
    await assert.rejects(
      tools.call("read_pages", { pages: [1], path: "C:/Users" }),
    );
    await assert.rejects(tools.call("write_file", {}), /不支持/);
    tools.close();
    tools = new ReadTools(f.dir, {
      documentId: f.doc.id,
      page: 4,
      scope: "page",
      extraPages: [],
    });
    const image = await tools.call("read_pages", { pages: [4] });
    assert.equal(image.content[1].type, "image");
    assert.ok((image.content[1] as any).data.length > 1000);
  } finally {
    tools?.close();
    f.close();
  }
});

test("保存的探索历史创建分支时仅携带目标之前的记录", async () => {
  const f = fixture();
  try {
    const first = f.add("早期背景"),
      target = f.add("修改这一轮"),
      future = f.add("未来秘密");
    for (const t of [first, target, future]) {
      t.threadTurnId = undefined;
      f.store.put("turn", t);
    }
    const seed = {
      id: randomUUID(),
      title: "探索",
      documentIds: [f.doc.id],
      turns: [first, target, future],
      createdAt: "2026-10-01",
    };
    f.store.put("context", seed);
    f.store.put("conversation", {
      ...f.c,
      threadId: undefined,
      seedContextId: seed.id,
    });
    const branch = await f.service.branch(target.id, "改问");
    const c = f.store.conversation(branch.conversationId)!;
    const context = f.store.get<typeof seed>("context", c.seedContextId!)!;
    assert.deepEqual(
      context.turns.map((t) => t.question),
      ["早期背景"],
    );
    assert.ok(!JSON.stringify(context).includes("未来秘密"));
    assert.equal(f.calls.length, 0);
    const firstBranch = await f.service.branch(first.id, "从头提问");
    assert.equal(
      f.store.conversation(firstBranch.conversationId)?.seedContextId,
      undefined,
    );
    assert.equal(f.store.get<typeof seed>("context", seed.id)?.turns.length, 3);
  } finally {
    f.close();
  }
});
