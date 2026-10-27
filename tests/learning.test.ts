import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.ts";
import { CourseService } from "../server/courses.ts";
import { KnowledgeService, type KnowledgeGenerator } from "../server/knowledge.ts";
import { NotesService } from "../server/notes.ts";
import { ReadingService } from "../server/reading.ts";
import { ChatService } from "../server/chat.ts";
import { Lifecycle } from "../server/lifecycle.ts";
import { captureKnowledge, captureNotes } from "../server/learning-context.ts";
import { chapterResults, summaryNeedsRefresh } from "../shared/learning.ts";
import type { ImportManager } from "../server/imports.ts";
import type { Codex } from "../server/codex.ts";
import type { ContextSnapshot, Document, KnowledgeRevision, LearningNote, Turn } from "../shared/types.ts";

function setup(generate: KnowledgeGenerator = async input => input.documentId ? `[页面](source:knowledge-${input.documentId.slice(0, 12)}-p${input.page})` : "章节 " + input.prompt) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "learning-"));
  const store = new Store(dir);
  mkdirSync(path.join(dir, "attachments"));
  const docs = ["a", "b"].map((n, i) => ({ id: n.repeat(64), name: `${i + 1}.pdf`, pages: 2, indexedPages: 2, indexStatus: "ready", page: 1, rotation: 0, zoom: 1, createdAt: "2026-10-22" }) as Document);
  docs.forEach(d => store.put("document", d));
  const courses = new CourseService(store, {} as ImportManager, () => {});
  const course = courses.create("测试课程", docs.map(d => d.id));
  const knowledge = new KnowledgeService(store, courses, generate, () => {});
  const notes = new NotesService(store, () => {});
  const lifecycle = new Lifecycle(store, {} as Codex, () => {}, () => {});
  const reading = new ReadingService(store, async () => {}, () => {}, () => {}, () => lifecycle.collect());
  const conversation = store.put("conversation", { id: randomUUID(), documentId: docs[0].id, courseId: course.id, title: "讨论", createdAt: "2026-10-22" });
  const selection = () => ({ id: randomUUID(), kind: "text" as const, documentId: docs[0].id, page: 1, rotation: 0, text: "第一行\n第二行", rect: [10, 20, 90, 50] as [number, number, number, number], rects: [[10, 20, 90, 30], [10, 40, 60, 50]] as [number, number, number, number][] });
  const open = (parentId?: string) => reading.create({ id: randomUUID(), parentId, conversationId: conversation.id, selection: selection(), settings: {}, layout: { x: .2, y: .2, width: 400, height: 440, minimized: false } });
  return { dir, store, docs, courses, course, knowledge, notes, lifecycle, reading, conversation, selection, open, close() { knowledge.close(); courses.close(); store.close(); assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "learning-"))); rmSync(dir, { recursive: true, force: true }); } };
}
async function finished(knowledge: KnowledgeService, id: string) {
  for (let i = 0; i < 200; i++) {
    if (knowledge.get(id).state !== "building") { await new Promise(r => setTimeout(r, 0)); return knowledge.get(id); }
    await new Promise(r => setTimeout(r, 5));
  }
  throw Error("整理未完成");
}

test("逐章发布、任务范围幂等、暂停恢复跳过已完成章节", async () => {
  const calls: string[] = [];
  let secondStarted!: () => void;
  const second = new Promise<void>(r => secondStarted = r);
  let hold = true;
  const f = setup(async input => {
    calls.push(input.documentId ? input.documentId[0] + input.page : "summary");
    if (input.documentId?.startsWith("b") && input.page === 1 && hold) {
      secondStarted();
      await new Promise((_resolve, reject) => input.signal.addEventListener("abort", () => reject(Error("paused")), { once: true }));
    }
    return "saved chapter";
  });
  try {
    const start = f.knowledge.start(f.course.id, { model: "vision" });
    assert.equal(f.knowledge.start(f.course.id, { model: "vision" }).id, start.id);
    assert.throws(() => f.knowledge.start(f.course.id, { model: "other" }), /先暂停/);
    assert.throws(() => f.knowledge.start(f.course.id, { model: "vision" }, { documentIds: [f.docs[0].id] }), /先暂停/);
    await second;
    const during = f.knowledge.get(start.id);
    assert.equal(during.state, "building");
    assert.equal(during.chapters[0].state, "completed");
    assert.ok(during.chapters[0].summary);
    assert.equal(captureKnowledge(f.store, f.course.id, f.course.documentIds).completed, 2);
    f.knowledge.cancel(start.id);
    await finished(f.knowledge, start.id);
    hold = false;
    f.knowledge.resume(start.id);
    const done = await finished(f.knowledge, start.id);
    assert.equal(done.state, "completed");
    assert.equal(calls.filter(x => x === "a1").length, 1);
    assert.equal(calls.filter(x => x === "summary").length, 3);
    assert.equal(done.chapters.length, 2);
  } finally { f.close(); }
});

test("章节缓存按模型和强度隔离，单章不附加课程汇总，强制分析不复用", async () => {
  let reads = 0, summaries = 0;
  const f = setup(async input => { input.documentId ? reads++ : summaries++; return "summary"; });
  try {
    const run = async (model: string, reasoningEffort: string, force = false) => finished(f.knowledge, f.knowledge.start(f.course.id, { model, reasoningEffort }, { documentIds: [f.docs[0].id], force }).id);
    assert.equal((await run("m1", "low")).summary, "");
    assert.equal(reads, 2); assert.equal(summaries, 1);
    assert.equal((await run("m1", "low")).reused, 2);
    assert.equal(reads, 2); assert.equal(summaries, 1);
    await run("m2", "low"); await run("m2", "high"); await run("m2", "high", true);
    assert.equal(reads, 8);
    const overview = await finished(f.knowledge, f.knowledge.start(f.course.id, { model: "m2" }, { overviewOnly: true }).id);
    assert.ok(overview.summary); assert.equal(reads, 8);
    assert.equal(f.knowledge.progress().at(-1)?.completed, 2);
    assert.equal(f.knowledge.progress().at(-1)?.total, 4);
    await run("m2", "high");
    const current = chapterResults(f.knowledge.list(f.course.id), f.course.documentIds);
    assert.equal(summaryNeedsRefresh(overview, current, f.course.documentIds), false, "复用相同摘要不使汇总过期");
    const changed = structuredClone(overview);
    changed.chapters[0].summary = "旧的不同内容";
    assert.equal(summaryNeedsRefresh(changed, current, f.course.documentIds), true);
    changed.chapters[0].summary = overview.chapters[0].summary;
    changed.chapters[0].summaryCompleted = 1;
    assert.equal(summaryNeedsRefresh(changed, current, f.course.documentIds), true, "覆盖页数变化需要重新汇总");
    assert.equal(summaryNeedsRefresh(overview, current, [f.docs[0].id]), true, "问答来源变化需要重新汇总");
  } finally { f.close(); }
});

test("笔记跨行来源固定、CAS 防覆盖、软删除恢复、独立课件与课程隔离", () => {
  const f = setup();
  try {
    const anchor = f.selection();
    const note = f.notes.create({ courseId: f.course.id, documentId: f.docs[0].id, anchor });
    assert.deepEqual(note.sources[0].rects, anchor.rects);
    const updated = f.notes.edit(note.id, { text: "理解后的笔记", version: 1 });
    assert.equal(updated.version, 2);
    assert.deepEqual(updated.sources, note.sources);
    assert.throws(() => f.notes.edit(note.id, { text: "迟到旧请求", version: 1 }), (e: any) => e.status === 409);
    assert.equal(f.notes.get(note.id).text, "理解后的笔记");
    f.notes.remove(note.id);
    assert.equal(f.notes.list({ courseId: f.course.id }).length, 0);
    assert.equal(captureNotes(f.store, f.course.id, f.course.documentIds).length, 0);
    assert.equal(f.notes.list({ courseId: f.course.id, deleted: true }).length, 1);
    f.notes.restore(note.id);
    const another = f.courses.create("另一课程", [f.docs[0].id]);
    f.notes.create({ courseId: another.id, documentId: f.docs[0].id, text: "另一课程" });
    f.notes.create({ documentId: f.docs[0].id, text: "独立笔记" });
    assert.equal(f.notes.list({ courseId: f.course.id }).length, 1);
    assert.equal(f.notes.list({ documentId: f.docs[0].id }).length, 1);
    assert.equal(captureNotes(f.store, another.id, [f.docs[0].id])[0].text, "另一课程");
    assert.equal(captureNotes(f.store, undefined, [f.docs[0].id])[0].text, "独立笔记");
  } finally { f.close(); }
});

test("独立课件会话与课程隔离；恢复旧任务按章节实际发布时间选取结果", () => {
  const f = setup();
  try {
    const chat = new ChatService(f.store, {} as Codex, () => {}, async () => {});
    const independent = f.store.put("conversation", { ...f.conversation, id: randomUUID(), courseId: undefined });
    assert.deepEqual(chat.list(f.docs[0].id).map(c => c.id), [independent.id]);
    const make = (id: string, createdAt: string, published: string, summary: string): KnowledgeRevision => ({ id, courseId: f.course.id, documentIds: [f.docs[0].id], pages: [], chapters: [{ documentId: f.docs[0].id, summary, updatedAt: published }], summary: "", state: "completed", total: 2, createdAt, settings: {} });
    const resumed = make("old", "2026-01-01", "2026-03-01", "恢复后发布");
    const newer = make("new", "2026-02-01", "2026-02-02", "上次发布");
    f.store.put("knowledge", resumed); f.store.put("knowledge", newer);
    assert.equal(chapterResults([resumed, newer], [f.docs[0].id]).get(f.docs[0].id)?.chapter.summary, "恢复后发布");
    assert.equal(f.knowledge.available(f.course.id, [f.docs[0].id])[0].summary, "恢复后发布");
    const excerpt = f.notes.create({ documentId: f.docs[0].id, anchor: { ...f.selection(), kind: "answer", text: "AI 解释摘录" } });
    assert.equal(excerpt.sources.length, 0);
    assert.ok(excerpt.text.includes("AI 解释摘录"));
  } finally { f.close(); }
});

test("收藏正式回答与子窗回答去重，关闭窗口或删除来源保留正文和附件", () => {
  const f = setup();
  try {
    const parent = f.open(), child = f.open(parent.id);
    const turn = f.reading.ask(child.id, "深一层的问题", randomUUID());
    turn.state = "completed"; turn.answer = "需要保留的回答 [原文](source:evidence)";
    turn.snapshot.sources = [{ id: "evidence", documentId: f.docs[0].id, page: 1, text: "原文证据" }];
    f.store.put("readingTurn", turn);
    const image = `${child.selection.id}-0.png`;
    writeFileSync(path.join(f.dir, "attachments", image), "frozen image");
    f.store.put("reading", { ...child, selection: { ...child.selection, image } });
    const note = f.notes.create({ courseId: f.course.id, turnId: turn.id, originKind: "readingTurn" });
    assert.equal(f.notes.create({ turnId: turn.id }).id, note.id);
    const formal: Turn = { ...turn, id: randomUUID(), readingSessionId: undefined, conversationId: f.conversation.id, question: "正式问题" };
    f.store.put("turn", formal);
    const formalNote = f.notes.create({ turnId: formal.id });
    assert.equal(f.notes.create({ turnId: formal.id }).id, formalNote.id);
    f.reading.close(parent.id); f.reading.close(child.id);
    assert.ok(existsSync(path.join(f.dir, "attachments", image)));
    assert.equal(f.notes.get(note.id).sources[0].text, "原文证据");
    f.lifecycle.deleteDocument(f.docs[0].id, false, id => f.reading.close(id), id => f.knowledge.cancel(id));
    assert.equal(f.notes.get(note.id).sources[0].deleted, true);
    assert.equal(f.notes.get(note.id).text, turn.answer);
    assert.equal(f.notes.edit(note.id, { version: 1, title: "删除来源后仍可编辑" }).title, "删除来源后仍可编辑");
  } finally { f.close(); }
});

test("问题与递归子窗冻结章节和笔记；来源取消选择后新问题只使用当前范围", async () => {
  const f = setup();
  try {
    await finished(f.knowledge, f.knowledge.start(f.course.id, {}).id);
    const n = f.notes.create({ courseId: f.course.id, documentId: f.docs[0].id, text: "旧笔记" });
    const root = f.open();
    const rootContext = f.store.get<ContextSnapshot>("context", root.contextId)!;
    f.notes.edit(n.id, { version: 1, text: "更新后的笔记" });
    f.courses.patch(f.course.id, { selectedDocumentIds: [f.docs[0].id] });
    const child = f.open(root.id);
    const childContext = f.store.get<ContextSnapshot>("context", child.contextId)!;
    assert.deepEqual(childContext.knowledgeSnapshot, rootContext.knowledgeSnapshot);
    assert.equal(childContext.notes?.[0].text, "旧笔记");
    assert.equal(childContext.documentIds.length, 2);
    const chat = new ChatService(f.store, {} as Codex, () => {}, async () => {});
    const turn = chat.create("现在的问题", { documentId: f.docs[0].id, conversationId: f.conversation.id, page: 1, rotation: 0, selectedText: "", scope: "full", extraPages: [] });
    assert.equal(turn.snapshot.knowledgeSnapshot?.chapters.length, 1);
    assert.equal(turn.snapshot.knowledgeSnapshot?.summary, "");
    assert.equal(turn.snapshot.noteSnapshot?.[0].text, "更新后的笔记");
    f.notes.edit(n.id, { version: 2, text: "再次修改" });
    assert.equal(f.store.turn(turn.id)?.snapshot.noteSnapshot?.[0].text, "更新后的笔记");
  } finally { f.close(); }
});

test("旧笔记迁移前备份；重新启动不清空历史正文或自动执行 AI", () => {
  const f = setup();
  try {
    const id = randomUUID();
    f.store.put("note", { id, courseId: f.course.id, title: "旧收藏", text: "旧正文", sources: [], createdAt: "2026-01-01" });
    f.store.db.exec("PRAGMA user_version=2");
    f.store.close();
    const reopened = new Store(f.dir);
    try {
      assert.ok(existsSync(path.join(f.dir, "before-learning-v3.sqlite")));
      const n = reopened.get<LearningNote>("note", id)!;
      assert.equal(n.text, "旧正文"); assert.equal(n.version, 1);
      assert.equal(n.updatedAt, "2026-01-01");
    } finally { reopened.close(); }
  } finally {
    f.knowledge.close(); f.courses.close();
    assert.ok(path.resolve(f.dir).startsWith(path.join(os.tmpdir(), "learning-")));
    rmSync(f.dir, { recursive: true, force: true });
  }
});
