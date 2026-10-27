import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "../server/store.ts";
import { ReadingService, relatedTurns } from "../server/reading.ts";
import { Lifecycle } from "../server/lifecycle.ts";
import {
  CourseService,
  scanDirectory,
  directoryChanges,
} from "../server/courses.ts";
import { ReadTools } from "../server/reader-tools.ts";
import { Scheduler } from "../server/scheduler.ts";
import { KnowledgeService } from "../server/knowledge.ts";
import { ChatService } from "../server/chat.ts";
import type { Codex } from "../server/codex.ts";
import type { ImportManager } from "../server/imports.ts";
import type {
  ContextSnapshot,
  Conversation,
  Document,
  ReadingSession,
  Turn,
} from "../shared/types.ts";

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pointer-test-")),
    store = new Store(dir);
  mkdirSync(path.join(dir, "attachments"));
  mkdirSync(path.join(dir, "pdfs"));
  mkdirSync(path.join(dir, "originals"));
  const docs = ["a", "b", "c"].map(
    (char, i) =>
      ({
        id: char.repeat(64),
        name: `第${i + 1}章.pdf`,
        pages: 2,
        indexedPages: 2,
        indexStatus: "ready",
        page: 1,
        rotation: 0,
        zoom: 1,
        createdAt: "2026-10-12",
      }) as Document,
  );
  for (const d of docs) store.put("document", d);
  const conversation: Conversation = {
    id: randomUUID(),
    documentId: docs[0].id,
    title: "学习背景",
    createdAt: "2026-10-12",
  };
  store.put("conversation", conversation);
  const add = (question: string, answer = question) => {
    const t: Turn = {
      id: randomUUID(),
      conversationId: conversation.id,
      question,
      answer,
      state: "completed",
      createdAt: new Date().toISOString(),
      snapshot: {
        documentId: docs[0].id,
        conversationId: conversation.id,
        page: 1,
        rotation: 0,
        selectedText: "",
        scope: "full",
        extraPages: [],
        sources: [
          {
            id: "source-" + randomUUID(),
            documentId: docs[0].id,
            page: 1,
            text: "原文",
          },
        ],
        images: [],
      },
    };
    store.put("turn", t);
    return t;
  };
  const deleted: string[] = [],
    aborted: string[] = [],
    executed: Turn[] = [];
  const ai = {
    connect: async () => {},
    rpc: async (_m: string, p: any) => {
      deleted.push(p.threadId);
      return {};
    },
  } as unknown as Codex;
  const lifecycle = new Lifecycle(
    store,
    ai,
    (id) => aborted.push(id),
    () => {},
  );
  const reading = new ReadingService(
    store,
    async (t) => {
      executed.push(t);
    },
    (id) => aborted.push(id),
    () => {},
    () => lifecycle.collect(),
  );
  const make = (parentId?: string) =>
    reading.create({
      id: randomUUID(),
      parentId,
      conversationId: conversation.id,
      selection: {
        id: randomUUID(),
        kind: "text",
        documentId: docs[0].id,
        page: 1,
        rotation: 0,
        text: "静态作用域",
      },
      settings: { model: "test-vision" },
      layout: { x: 0.5, y: 0.2, width: 400, height: 440, minimized: false },
    });
  return {
    dir,
    store,
    docs,
    conversation,
    add,
    lifecycle,
    reading,
    make,
    deleted,
    aborted,
    executed,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("课程 FTS5：同页码跨文档区分、中文分词、转义查询、未选来源拒绝", async () => {
  const f = fixture();
  let tools: ReadTools | undefined;
  try {
    f.store.page(f.docs[0].id, 1, "静态作用域 lexical scope 查找定义处环境");
    f.store.page(f.docs[1].id, 1, "动态作用域 dynamic scope 查找调用处环境");
    f.store.page(f.docs[2].id, 1, "秘密未选中来源 静态作用域");
    const hits = f.store.searchDocuments(
      f.docs.slice(0, 2).map((d) => d.id),
      '作用域 " OR *',
    );
    assert.equal(hits.length, 2);
    assert.equal(new Set(hits.map((h) => h.documentId)).size, 2);
    tools = new ReadTools(f.dir, {
      documentId: f.docs[0].id,
      documentIds: f.docs.slice(0, 2).map((d) => d.id),
      page: 1,
      scope: "full",
      extraPages: [],
    });
    const found = JSON.parse(
      (
        (await tools.call("search_course", { query: "作用域" })).content[0] as {
          text: string;
        }
      ).text,
    );
    assert.equal(found.sources.length, 2);
    assert.equal(new Set(found.sources.map((s: any) => s.id)).size, 2);
    await assert.rejects(
      tools.call("read_pages", { documentId: f.docs[2].id, pages: [1] }),
      /范围/,
    );
    const outline = JSON.parse(
      (
        (await tools.call("course_outline", { documentId: f.docs[1].id }))
          .content[0] as { text: string }
      ).text,
    );
    assert.equal(outline.documentId, f.docs[1].id);
    assert.equal(outline.documents.length, 2);
  } finally {
    tools?.close();
    f.close();
  }
});
test("递归解释快照：排除未完成/未来/兄弟讨论，父窗关闭后子窗和共享附件仍可用", async () => {
  const f = fixture();
  let tools: ReadTools | undefined;
  try {
    const before = f.add("课前暗号", "银杏树"),
      unfinished = f.add("流式中", "不能继承未完成内容");
    unfinished.state = "generating";
    f.store.put("turn", unfinished);
    const root = f.make();
    f.add("未来暗号", "紫色企鹅");
    const rootTurn = f.reading.ask(root.id, "解释变量绑定", randomUUID());
    rootTurn.state = "completed";
    rootTurn.answer = "父窗独有的定义位置";
    rootTurn.snapshot.images = [`${rootTurn.id}-0.png`];
    writeFileSync(
      path.join(f.dir, "attachments", rootTurn.snapshot.images[0]),
      "crop",
    );
    f.store.put("readingTurn", rootTurn);
    const child = f.make(root.id),
      sibling = f.make(root.id),
      siblingTurn = f.reading.ask(sibling.id, "兄弟秘密", randomUUID());
    siblingTurn.state = "completed";
    siblingTurn.answer = "兄弟暗号红石";
    f.store.put("readingTurn", siblingTurn);
    const context = f.store.get<ContextSnapshot>("context", child.contextId)!;
    assert.deepEqual(
      context.turns.map((t) => t.id),
      [before.id, rootTurn.id],
    );
    assert.ok(!JSON.stringify(context).includes("紫色企鹅"));
    assert.ok(!JSON.stringify(context).includes("红石"));
    f.reading.close(root.id);
    assert.equal(f.reading.list().length, 2);
    assert.ok(
      existsSync(path.join(f.dir, "attachments", rootTurn.snapshot.images[0])),
    );
    assert.ok(f.store.get("context", child.contextId));
    tools = new ReadTools(f.dir, {
      documentId: f.docs[0].id,
      documentIds: [f.docs[0].id],
      contextSnapshotId: child.contextId,
      page: 1,
      scope: "full",
      extraPages: [],
    });
    const history = JSON.parse(
      (
        (await tools.call("search_history", { query: "暗号" })).content[0] as {
          text: string;
        }
      ).text,
    );
    assert.equal(history.turns.length, 1);
    assert.match(history.turns[0].answer, /银杏树/);
    tools.close();
    tools = undefined;
    f.reading.close(child.id);
    f.reading.close(sibling.id);
    assert.equal(f.store.all("readingTurn").length, 0);
    assert.equal(f.store.all("context").length, 0);
    assert.equal(
      existsSync(path.join(f.dir, "attachments", rootTurn.snapshot.images[0])),
      false,
    );
    assert.throws(
      () => f.reading.create({ ...root, conversationId: f.conversation.id }),
      /已关闭/,
    );
  } finally {
    tools?.close();
    f.close();
  }
});
test("临时窗发送幂等、关闭取消、重启保留位置草稿但不重放请求", () => {
  const f = fixture();
  try {
    const root = f.make(),
      key = randomUUID(),
      t = f.reading.ask(root.id, "同一个问题", key);
    assert.equal(f.reading.ask(root.id, "同一个问题", key).id, t.id);
    assert.equal(f.executed.length, 1);
    t.answer = "重启前已经生成的部分回答";
    t.state = "generating";
    f.store.put("readingTurn", t);
    f.reading.patch(root.id, {
      draft: "下一条草稿",
      layout: { ...root.layout, x: 0.15, width: 555 },
    });
    let resumedCalls = 0;
    const resumed = new ReadingService(
      f.store,
      async () => {
        resumedCalls++;
      },
      () => {},
      () => {},
      () => {},
    );
    assert.equal(resumedCalls, 0);
    assert.equal(resumed.get(root.id).draft, "下一条草稿");
    assert.equal(resumed.get(root.id).layout.width, 555);
    assert.equal(resumed.turns(root.id)[0].state, "stopped");
    assert.equal(resumed.turns(root.id)[0].answer, "重启前已经生成的部分回答");
    const next = resumed.ask(root.id, "新请求", randomUUID());
    assert.equal(resumedCalls, 1);
    f.reading.close(root.id);
    assert.ok(f.aborted.includes(next.id));
    assert.equal(f.store.all("reading").length, 0);
  } finally {
    f.close();
  }
});
test("保存临时探索后关闭仍保留正式证据，删除原会话不破坏分支与独立快照", async () => {
  const f = fixture();
  try {
    const old = f.add("原会话背景"),
      root = f.make(),
      t = f.reading.ask(root.id, "当前术语", randomUUID());
    t.state = "completed";
    t.answer = "应保存的探索";
    t.snapshot.images = [`${t.id}-0.png`];
    writeFileSync(
      path.join(f.dir, "attachments", t.snapshot.images[0]),
      "shared",
    );
    f.store.put("readingTurn", t);
    const saved = f.reading.promote(root.id);
    assert.equal(f.reading.promote(root.id).id, saved.id);
    f.reading.close(root.id);
    assert.ok(
      existsSync(path.join(f.dir, "attachments", t.snapshot.images[0])),
    );
    assert.ok(f.store.get("context", saved.seedContextId!));
    f.lifecycle.own("owned-old", f.conversation.id);
    f.lifecycle.own("owned-branch", saved.id);
    f.lifecycle.deleteConversation(f.conversation.id);
    await f.lifecycle.cleanupThreads();
    assert.ok(f.deleted.includes("owned-old"));
    assert.ok(!f.deleted.includes("owned-branch"));
    assert.ok(f.store.conversation(saved.id));
    assert.ok(
      f.store.all<Turn>("turn").some((t) => t.answer === "应保存的探索"),
    );
    f.lifecycle.deleteConversation(saved.id);
    await f.lifecycle.cleanupThreads();
    assert.equal(f.store.all("context").length, 0);
    assert.equal(
      existsSync(path.join(f.dir, "attachments", t.snapshot.images[0])),
      false,
    );
  } finally {
    f.close();
  }
});
test("删除资料默认保留问答与冻结图像，标记旧来源；不删除硬盘原文件", () => {
  const f = fixture();
  try {
    const t = f.add("已有回答");
    f.store.page(f.docs[0].id, 1, "可检索内容");
    const original = path.join(f.dir, "user-original.pdf");
    writeFileSync(original, "original");
    writeFileSync(path.join(f.dir, "pdfs", f.docs[0].id + ".pdf"), "copy");
    f.lifecycle.deleteDocument(
      f.docs[0].id,
      false,
      (id) => f.reading.close(id),
      () => {},
    );
    assert.equal(f.store.document(f.docs[0].id), undefined);
    assert.equal(f.store.pages(f.docs[0].id).length, 0);
    assert.equal(f.store.turn(t.id)?.answer, "已有回答");
    assert.equal(f.store.turn(t.id)?.snapshot.sources[0].deleted, true);
    assert.equal(readFileSync(original, "utf8"), "original");
    assert.equal(f.store.searchDocuments([f.docs[0].id], "可检索").length, 0);
  } finally {
    f.close();
  }
});
test("目录新增、覆盖、移动、删除先确认；离线保留课件，哈希变化拒绝旧确认", async () => {
  const f = fixture();
  let courses: CourseService | undefined;
  try {
    const folder = path.join(f.dir, "user-course");
    mkdirSync(folder);
    writeFileSync(path.join(folder, "a.pdf"), "version one");
    let calls = 0;
    const imports = {
      create: async (bytes: Buffer, name: string) => {
        calls++;
        const hash = createHash("sha256").update(bytes).digest("hex");
        f.store.put("document", { ...f.docs[0], id: hash, name });
        return { id: randomUUID(), state: "completed", documentId: hash };
      },
    } as unknown as ImportManager;
    courses = new CourseService(f.store, imports, () => {});
    const c = courses.create("课程"),
      scan = await courses.bind(c.id, folder);
    assert.equal(calls, 0);
    assert.equal(scan.changes[0].type, "added");
    await courses.sync(c.id, scan.scanId!, ["a.pdf"]);
    assert.equal(calls, 1);
    const oldId = courses.get(c.id).documentIds[0];
    renameSync(path.join(folder, "a.pdf"), path.join(folder, "b.pdf"));
    const moved = await courses.scan(c.id);
    assert.equal(moved.changes[0].type, "moved");
    assert.equal(courses.get(c.id).files[0].path, "a.pdf");
    await courses.sync(c.id, moved.scanId!, ["b.pdf"]);
    assert.equal(calls, 1);
    writeFileSync(path.join(folder, "b.pdf"), "version two");
    const modified = await courses.scan(c.id);
    assert.equal(modified.changes[0].type, "modified");
    writeFileSync(path.join(folder, "b.pdf"), "version three");
    await assert.rejects(
      courses.sync(c.id, modified.scanId!, ["b.pdf"]),
      /再次变化/,
    );
    assert.ok(f.store.document(oldId));
    const latest = await courses.scan(c.id);
    await courses.sync(c.id, latest.scanId!, ["b.pdf"]);
    assert.equal(calls, 2);
    assert.ok(f.store.document(oldId));
    courses.unbind(c.id);
    renameSync(folder, folder + "-moved");
    await courses.bind(c.id, folder + "-moved");
    renameSync(folder + "-moved", folder);
    const offline = await courses.scan(c.id);
    assert.ok(offline.offline);
    assert.equal(offline.documentIds.length, 1);
  } finally {
    courses?.close();
    f.close();
  }
});
test("知识构建覆盖真实页数，失败页不算读完，重试仅重读失败页；来源变化使总览失效", async () => {
  const f = fixture();
  let courses: CourseService | undefined,
    knowledge: KnowledgeService | undefined;
  try {
    courses = new CourseService(f.store, {} as ImportManager, () => {});
    const c = courses.create(
      "两章课程",
      f.docs.slice(0, 2).map((d) => d.id),
    );
    const calls: string[] = [];
    let fail = true;
    knowledge = new KnowledgeService(
      f.store,
      courses,
      async (input) => {
        if (input.documentId) {
          const key = input.documentId + ":" + input.page;
          calls.push(key);
          if (input.documentId === f.docs[1].id && input.page === 2 && fail)
            throw Error("测试失败页");
          return "页面摘要";
        }
        return "课程关系总览";
      },
      () => {},
    );
    const wait = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        if (knowledge!.get(id).state !== "building") return;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw Error("构建未结束");
    };
    const revision = knowledge.start(c.id, {});
    await wait(revision.id);
    assert.equal(knowledge.get(revision.id).state, "partial");
    assert.equal(knowledge.get(revision.id).total, 4);
    assert.equal(
      knowledge.get(revision.id).pages.filter((p) => p.state === "completed")
        .length,
      3,
    );
    fail = false;
    knowledge.resume(revision.id, true);
    await wait(revision.id);
    assert.equal(knowledge.get(revision.id).state, "completed");
    assert.equal(calls.length, 5);
    courses.patch(c.id, { selectedDocumentIds: [f.docs[0].id] });
    assert.equal(courses.get(c.id).knowledgeStale, true);
    assert.equal(knowledge.context(revision.id, [f.docs[0].id]), "");
    const next = knowledge.start(c.id, {});
    await wait(next.id);
    assert.equal(calls.length, 5);
    assert.equal(knowledge.get(next.id).total, 2);
  } finally {
    knowledge?.close();
    courses?.close();
    f.close();
  }
});
test("重启修复目录导入关联，并保留知识来源取消勾选和主动移除", () => {
  const f = fixture();
  let courses: CourseService | undefined;
  try {
    courses = new CourseService(f.store, {} as ImportManager, () => {});
    const c = courses.create("计算理论");
    courses.save({ ...c, files: [{ path: "a.pdf", hash: f.docs[0].id, documentId: f.docs[0].id, selected: true, size: 1, modifiedAt: 0 }] });
    courses.close();
    courses = new CourseService(f.store, {} as ImportManager, () => {});
    assert.deepEqual(courses.get(c.id).documentIds, [f.docs[0].id]);
    assert.deepEqual(courses.get(c.id).selectedDocumentIds, [f.docs[0].id]);
    courses.patch(c.id, { selectedDocumentIds: [] });
    courses.imported(f.docs[0]);
    assert.deepEqual(courses.get(c.id).selectedDocumentIds, []);
    courses.patch(c.id, { documentIds: [] });
    assert.equal(courses.get(c.id).files[0].selected, false);
    courses.imported(f.docs[0]);
    assert.deepEqual(courses.get(c.id).documentIds, []);
  } finally { courses?.close(); f.close(); }
});

test("目录批量异步转换：同步期间和之后完成的课件都进入正确课程", async () => {
  const f = fixture();
  let courses: CourseService | undefined;
  try {
    const folder = path.join(f.dir, "lectures");
    mkdirSync(folder);
    writeFileSync(path.join(folder, "one.pdf"), "first");
    writeFileSync(path.join(folder, "two.pdf"), "second");
    const pending: Document[] = [];
    const imports = { create: async (bytes: Buffer, name: string) => {
      const id = createHash("sha256").update(bytes).digest("hex");
      const doc = { ...f.docs[0], id, name };
      pending.push(doc);
      if (pending.length === 1) { f.store.put("document", doc); courses!.imported(doc); }
      return { id: randomUUID(), hash: id, state: "queued" };
    } } as unknown as ImportManager;
    courses = new CourseService(f.store, imports, () => {});
    const c = courses.create("计算理论");
    const scanned = await courses.bind(c.id, folder);
    await courses.sync(c.id, scanned.scanId!, ["one.pdf", "two.pdf"]);
    assert.deepEqual(courses.get(c.id).documentIds, [pending[0].id]);
    f.store.put("document", pending[1]); courses.imported(pending[1]);
    assert.deepEqual(courses.get(c.id).documentIds, pending.map((d) => d.id));
    courses.patch(c.id, { selectedDocumentIds: [pending[1].id] });
    const next = await courses.scan(c.id);
    await courses.sync(c.id, next.scanId!, ["one.pdf", "two.pdf"]);
    assert.deepEqual(courses.get(c.id).selectedDocumentIds, [pending[1].id]);
    assert.ok(courses.get(c.id).files.every((file) => file.importJobId));
  } finally { courses?.close(); f.close(); }
});

test("调度器最多两任务，前台优先；关闭排队任务不会启动", async () => {
  const q = new Scheduler(2),
    s = new AbortController(),
    a = await q.acquire(s.signal),
    b = await q.acquire(s.signal),
    order: string[] = [];
  const bg = q.acquire(s.signal, true).then((release) => {
      order.push("background");
      release();
    }),
    front = q.acquire(s.signal).then((release) => {
      order.push("foreground");
      release();
    });
  const cancel = new AbortController(),
    cancelled = q.acquire(cancel.signal);
  const rejected = assert.rejects(cancelled, /停止/);
  cancel.abort();
  a();
  await Promise.all([bg, front, rejected]);
  b();
  assert.deepEqual(order, ["foreground", "background"]);
});
