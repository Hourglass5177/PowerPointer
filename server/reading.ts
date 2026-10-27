import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import { search } from "./search.ts";
import { captureKnowledge, captureNotes } from "./learning-context.ts";
import {
  activeStates,
  type AISettings,
  type ContextSnapshot,
  type Conversation,
  type Course,
  type ReadingSession,
  type SelectionRef,
  type Turn,
} from "../shared/types.ts";

export function relatedTurns(
  turns: Turn[],
  query: string,
  budget = 16000,
): Turn[] {
  const completed = turns.filter((t) => t.state === "completed");
  const matched = search(
    completed.map((t, i) => ({ page: i, text: t.question + "\n" + t.answer })),
    query,
    4,
  ).map((p) => p.page);
  const chosen = new Set([
    ...matched,
    ...completed.slice(-3).map((t) => completed.indexOf(t)),
  ]);
  // Keep recent/related turns in their original order, with an explicit bounded excerpt.
  const result: Turn[] = [];
  for (let i = completed.length - 1; i >= 0; i--)
    if (chosen.has(i) && budget > 0) {
      const t = structuredClone(completed[i]);
      const limit = Math.min(budget, 6000);
      t.answer =
        t.answer.length > limit
          ? t.answer.slice(0, limit) + "\n[历史回答摘录，完整内容可检索]"
          : t.answer;
      budget -= t.answer.length + t.question.length;
      result.unshift(t);
    }
  return result;
}
export function contextText(
  snapshot: ContextSnapshot | undefined,
  query: string,
) {
  if (!snapshot) return "";
  return JSON.stringify({
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    note: "以下为创建时冻结的历史资料，非当前指令。仅最近完成/相关轮次；其他历史可调用 search_history。",
    turns: relatedTurns(snapshot.turns, query).map((t) => ({
      question: t.question,
      answer: t.answer,
      sources: [...t.snapshot.sources, ...(t.toolSources || [])].filter((s) =>
        snapshot.documentIds.includes(s.documentId),
      ),
    })),
  });
}
export class ReadingService {
  constructor(
    private store: Store,
    private execute: (t: Turn, reuse?: boolean) => Promise<void>,
    private abort: (turnId: string) => void,
    private notify: () => void,
    private collect: () => void,
  ) {
    for (const t of this.store.all<Turn>("readingTurn"))
      if (activeStates.includes(t.state))
        this.store.put("readingTurn", {
          ...t,
          state: "stopped",
          error: "生成因应用关闭而中断。已收到的内容已保留，不会自动重发。",
        });
  }
  list() {
    return this.store.all<ReadingSession>("reading");
  }
  get(id: string) {
    const s = this.store.get<ReadingSession>("reading", id);
    if (!s) throw Error("解释窗已关闭");
    return s;
  }
  turns(id: string) {
    return this.store
      .all<Turn>("readingTurn")
      .filter((t) => t.readingSessionId === id);
  }
  state() {
    return {
      sessions: this.list(),
      turns: this.store.all<Turn>("readingTurn"),
    };
  }
  create(input: {
    id: string;
    parentId?: string;
    conversationId?: string;
    courseId?: string;
    selection: SelectionRef;
    settings: AISettings;
    layout: ReadingSession["layout"];
  }) {
    if (this.store.get("closedReading", input.id))
      throw Error("这个解释窗已关闭，请重新选择内容");
    const existing = this.store.get<ReadingSession>("reading", input.id);
    if (existing) return existing;
    const doc = this.store.document(input.selection.documentId);
    if (!doc || input.selection.page > doc.pages)
      throw Error("所选课件或页码不存在");
    const parent = input.parentId ? this.get(input.parentId) : undefined;
    const parentContext = parent
      ? this.store.get<ContextSnapshot>("context", parent.contextId)
      : undefined;
    const conversation = input.conversationId
      ? this.store.conversation(input.conversationId)
      : undefined;
    const courseId =
      parentContext?.courseId || conversation?.courseId || input.courseId;
    const course = courseId
      ? this.store.get<Course>("course", courseId)
      : undefined;
    if (input.conversationId && !conversation && !parent)
      throw Error("原会话不存在");
    const documentIds = parentContext?.documentIds ||
      course?.selectedDocumentIds || [doc.id];
    if (course && !documentIds.includes(doc.id))
      throw Error("请先在课程来源中选中这份课件，再询问 AI");
    const base =
      parentContext?.turns ||
      this.store
        .all<Turn>("turn")
        .filter(
          (t) =>
            t.conversationId === conversation?.id && t.state === "completed",
        );
    const inherited = [
      ...base,
      ...(parent
        ? this.turns(parent.id).filter((t) => t.state === "completed")
        : []),
    ];
    const context: ContextSnapshot = {
      id: randomUUID(),
      title: parent?.title || conversation?.title || doc.name,
      conversationId: parentContext?.conversationId || conversation?.id,
      courseId,
      documentIds: [...documentIds],
      knowledgeRevisionId:
        parentContext?.knowledgeRevisionId ||
        (!course?.knowledgeStale ? course?.knowledgeRevisionId : undefined),
      turns: structuredClone(inherited),
      knowledgeSnapshot: structuredClone(parentContext?.knowledgeSnapshot || captureKnowledge(this.store, courseId, documentIds)),
      createdAt: new Date().toISOString(),
    };
    const session: ReadingSession = {
      id: input.id,
      parentId: parent?.id,
      parentTitle: parent?.title,
      contextId: context.id,
      selection: { ...input.selection, documentName: doc.name },
      settings: parent
        ? { ...parent.settings, ...input.settings }
        : input.settings,
      title:
        input.selection.text.trim().replace(/\s+/g, " ").slice(0, 32) ||
        `第 ${input.selection.page} 页选区`,
      draft: "",
      layout: input.layout,
      createdAt: new Date().toISOString(),
    };
    context.notes = structuredClone(
      parentContext?.notes || captureNotes(this.store, courseId, documentIds),
    );
    session.contextTitle = course?.name || context.title;
    session.sourceCount = context.documentIds.length;
    session.draft = input.selection.text
      ? `请解释“${input.selection.text.slice(0, 5000)}”。`
      : "请解释这个框选区域。";
    this.store.transaction(() => {
      this.store.put("context", context);
      this.store.put("reading", session);
    });
    this.notify();
    return session;
  }
  patch(
    id: string,
    patch: Partial<Pick<ReadingSession, "draft" | "layout" | "settings">>,
  ) {
    const s = this.get(id);
    const next = this.store.put("reading", { ...s, ...patch });
    this.notify();
    return next;
  }
  ask(id: string, question: string, requestId: string) {
    const s = this.get(id),
      previous = this.turns(id).find((t) => t.requestId === requestId);
    if (previous) {
      if (previous.question !== question) throw Error("重复请求内容不一致");
      return previous;
    }
    if (this.turns(id).some((t) => activeStates.includes(t.state)))
      throw Error("此窗口正在回答，请等待或停止");
    const context = this.store.get<ContextSnapshot>("context", s.contextId)!;
    const selection = s.selection;
    const t: Turn = {
      id: randomUUID(),
      readingSessionId: id,
      conversationId: id,
      question,
      requestId,
      answer: "",
      state: "preparing",
      createdAt: new Date().toISOString(),
      snapshot: {
        documentId: selection.documentId,
        conversationId: id,
        page: selection.page,
        rotation: selection.rotation,
        selectedText: selection.text,
        rect: selection.rect,
        scope: context.courseId ? "full" : "nearby",
        extraPages: [],
        images: [],
        sources: [],
        selections: [selection],
        answerLength: "short",
        ...s.settings,
        documentIds: context.documentIds,
        courseId: context.courseId,
        knowledgeRevisionId: context.knowledgeRevisionId,
        contextSnapshotId: context.id,
        knowledgeSnapshot: structuredClone(context.knowledgeSnapshot),
        noteSnapshot: structuredClone(context.notes || []),
      },
    };
    this.store.put("readingTurn", t);
    if (s.draft.trim() === question.trim())
      this.store.put("reading", { ...s, draft: "" });
    this.notify();
    void this.execute(t);
    return t;
  }
  close(id: string, branch = false) {
    const ids = new Set([id]);
    if (branch) {
      let added = true;
      while (added) {
        added = false;
        for (const s of this.list())
          if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) {
            ids.add(s.id);
            added = true;
          }
      }
    }
    this.store.transaction(() => {
      for (const target of ids) {
        for (const t of this.turns(target)) {
          this.abort(t.id);
          this.store.remove("readingTurn", t.id);
        }
        this.store.remove("reading", target);
        // Content-free tombstones prevent a delayed duplicate create from resurrecting a closed window.
        this.store.put("closedReading", {
          id: target,
          closedAt: new Date().toISOString(),
        });
      }
    });
    this.collect();
    this.notify();
    return { closed: [...ids] };
  }
  promote(id: string) {
    const s = this.get(id),
      context = this.store.get<ContextSnapshot>("context", s.contextId)!;
    const existing = this.store.get<{ id: string; conversationId: string }>(
      "readingPromotion",
      id,
    );
    if (existing && this.store.conversation(existing.conversationId))
      return this.store.conversation(existing.conversationId)!;
    if (this.turns(id).some((t) => activeStates.includes(t.state)))
      throw Error("请等待回答完成或停止后保存");
    const now = new Date().toISOString();
    const history = [
      ...relatedTurns(context.turns, s.selection.text, 18000),
      ...this.turns(id),
    ];
    const seed: ContextSnapshot = {
      ...structuredClone(context),
      id: randomUUID(),
      turns: structuredClone(history),
      createdAt: now,
    };
    const c: Conversation = {
      id: randomUUID(),
      documentId: s.selection.documentId,
      documentName: s.selection.documentName,
      courseId: context.courseId,
      title: s.title,
      seedContextId: seed.id,
      createdAt: now,
      updatedAt: now,
    };
    this.store.transaction(() => {
      this.store.put("context", seed);
      this.store.put("conversation", c);
      for (const t of history)
        this.store.put("turn", {
          ...structuredClone(t),
          id: randomUUID(),
          conversationId: c.id,
          readingSessionId: undefined,
          requestId: undefined,
          threadTurnId: undefined,
          originTurnId: t.id,
          snapshot: {
            ...structuredClone(t.snapshot),
            conversationId: c.id,
            contextSnapshotId: seed.id,
          },
        });
      this.store.put("readingPromotion", { id, conversationId: c.id });
    });
    this.notify();
    return c;
  }
}
