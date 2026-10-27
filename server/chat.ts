import { createHash, randomUUID } from "node:crypto";
import {
  activeStates,
  type Conversation,
  type QuestionSnapshot,
  type Turn,
  type Course,
  type ContextSnapshot,
} from "../shared/types.ts";
import { autoTitle } from "../shared/chat.ts";
import type { Store } from "./store.ts";
import type { Codex } from "./codex.ts";
import { captureKnowledge, captureNotes } from "./learning-context.ts";

type RequestRecord = {
  id: string;
  signature: string;
  state: "pending" | "done" | "failed";
  turnId?: string;
  error?: string;
};
type ChatAI = Pick<Codex, "thread" | "fork" | "readTurn">;
export type BranchOptions = Pick<
  QuestionSnapshot,
  "model" | "reasoningEffort" | "agentTools" | "webSearch" | "answerLength" | "connectionId" | "assistantId" | "textOnly"
>;
export class ChatService {
  private pending = new Map<string, Promise<Turn>>();
  private branchLocks = new Set<string>();
  constructor(
    private store: Store,
    private ai: ChatAI,
    private publish: (t: Turn) => void,
    private execute: (t: Turn, reuse?: boolean) => Promise<void>,
  ) {
    for (const r of store.all<RequestRecord>("chatRequest"))
      if (r.state === "pending") {
        store.put("chatRequest", {
          ...r,
          state: "failed",
          error: "创建分支期间应用关闭，尚未提交新的问题。请重新操作。",
        });
      }
  }
  turns(id: string) {
    return this.store.all<Turn>("turn").filter((t) => t.conversationId === id);
  }
  conversation(id: string) {
    const c = this.store.conversation(id);
    if (!c) throw Error("会话不存在");
    return c;
  }
  assertIdle(id: string) {
    if (
      this.branchLocks.has(id) ||
      this.turns(id).some((t) => activeStates.includes(t.state))
    )
      throw Error("当前会话正在处理，请等待完成或停止后重试。");
  }
  list(documentId: string, q = "") {
    const query = q.trim().toLocaleLowerCase();
    return this.store
      .all<Conversation>("conversation")
      .filter((c) => c.documentId === documentId && !c.courseId)
      .map((c) => {
        const match = query
          ? this.turns(c.id).find((t) =>
              (t.question + "\n" + t.answer)
                .toLocaleLowerCase()
                .includes(query),
            )
          : undefined;
        return {
          ...c,
          matchText: match
            ? (match.question + " · " + match.answer).slice(0, 160)
            : undefined,
          matches:
            !query || c.title.toLocaleLowerCase().includes(query) || !!match,
        };
      })
      .filter((c) => c.matches)
      .map(({ matches, ...c }) => c)
      .sort(
        (a, b) =>
          Number(!!b.pinned) - Number(!!a.pinned) ||
          (b.updatedAt || b.createdAt).localeCompare(
            a.updatedAt || a.createdAt,
          ),
      );
  }
  patch(
    id: string,
    patch: Partial<Pick<Conversation, "title" | "pinned" | "archived">>,
  ) {
    const c = this.conversation(id);
    if (patch.archived) this.assertIdle(id);
    return this.store.put("conversation", {
      ...c,
      ...patch,
      ...(patch.title !== undefined ? { titleEdited: true } : {}),
    });
  }
  private transaction<T>(fn: () => T) {
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.store.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
  }
  private existing(requestId: string | undefined, signature: string) {
    if (!requestId) return;
    const r = this.store.get<RequestRecord>("chatRequest", requestId);
    if (!r) return;
    if (r.signature !== signature) throw Error("重复请求的内容不一致。");
    if (r.state === "done") return this.store.turn(r.turnId!)!;
    if (r.state === "failed") throw Error(r.error || "请求失败，请重新操作。");
    if (!this.pending.has(requestId))
      throw Error("请求结果尚未确认，请刷新后检查会话。");
  }
  private signature(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  private saveRequest(id: string | undefined, signature: string, t: Turn) {
    if (id)
      this.store.put<RequestRecord>("chatRequest", {
        id,
        signature,
        state: "done",
        turnId: t.id,
      });
  }
  create(
    question: string,
    snapshot: Omit<QuestionSnapshot, "images" | "sources">,
    requestId?: string,
  ) {
    const sig = this.signature({ question, snapshot });
    const prior = this.existing(requestId, sig);
    if (prior) return prior;
    const c = this.conversation(snapshot.conversationId),
      d = this.store.document(snapshot.documentId);
    const course = c.courseId
      ? this.store.get<Course>("course", c.courseId)
      : undefined;
    if (!d || (c.documentId !== d.id && !course?.documentIds.includes(d.id)))
      throw Error("会话和课件不匹配");
    if (course && !course.selectedDocumentIds.includes(d.id))
      throw Error("请在课程来源中选中当前课件再发送");
    snapshot = {
      ...snapshot,
      courseId: c.courseId,
      documentIds: course ? [...course.selectedDocumentIds] : [d.id],
      knowledgeRevisionId: !course?.knowledgeStale
        ? course?.knowledgeRevisionId
        : undefined,
      contextSnapshotId: c.seedContextId,
      knowledgeSnapshot: captureKnowledge(this.store, c.courseId, course?.selectedDocumentIds || [d.id]),
      noteSnapshot: captureNotes(this.store, c.courseId, course?.selectedDocumentIds || [d.id]),
    };
    for (const s of snapshot.selections || [])
      if (
        !snapshot.documentIds?.includes(s.documentId) ||
        !this.store.document(s.documentId)
      )
        throw Error("引用不属于本轮选定来源");
    if (c.archived) throw Error("请先恢复已归档会话。");
    if (snapshot.page > d.pages || snapshot.extraPages.some((p) => p > d.pages))
      throw Error("页码超出课件范围");
    if (
      snapshot.replyTurnId &&
      this.store.turn(snapshot.replyTurnId)?.conversationId !== c.id
    )
      throw Error("追问目标不属于当前会话。");
    this.assertIdle(c.id);
    const now = new Date().toISOString();
    const t: Turn = {
      id: randomUUID(),
      conversationId: c.id,
      question,
      snapshot: { ...structuredClone(snapshot), images: [], sources: [] },
      answer: "",
      state: "preparing",
      createdAt: now,
      requestId,
    };
    this.transaction(() => {
      const title =
        !c.titleEdited && !this.turns(c.id).length
          ? autoTitle(question)
          : c.title;
      this.store.put("conversation", { ...c, title, updatedAt: now });
      this.store.put("turn", t);
      this.saveRequest(requestId, sig, t);
    });
    this.publish(t);
    void this.execute(t);
    return t;
  }
  async branch(
    id: string,
    question?: string,
    requestId: string = randomUUID(),
    options?: BranchOptions,
  ): Promise<Turn> {
    const sig = this.signature({ branch: id, question, options });
    const prior = this.existing(requestId, sig);
    if (prior) return prior;
    const pending = this.pending.get(requestId);
    if (pending) return pending;
    const work = this.makeBranch(id, question, requestId, sig, options);
    this.pending.set(requestId, work);
    try {
      return await work;
    } finally {
      this.pending.delete(requestId);
    }
  }
  private async makeBranch(
    id: string,
    question: string | undefined,
    requestId: string,
    signature: string,
    options?: BranchOptions,
  ) {
    const target = this.store.turn(id);
    if (!target) throw Error("问题不存在");
    const parent = this.conversation(target.conversationId);
    this.assertIdle(parent.id);
    this.branchLocks.add(parent.id);
    this.store.put<RequestRecord>("chatRequest", {
      id: requestId,
      signature,
      state: "pending",
    });
    try {
      if (target.state === "unknown") await this.reconcile(target);
      if (target.state === "unknown")
        throw Error("原问题结果仍未确认，无法安全重试。请检查连接后重试核对。");
      const all = this.turns(parent.id),
        prefix = all.slice(
          0,
          all.findIndex((t) => t.id === id),
        );
      const previous = [...prefix].reverse().find((t) => t.threadTurnId);
      let threadId: string | undefined;
      let seedContextId = previous ? parent.seedContextId : undefined;
      const portable = !!previous?.runtimeThreadId && previous.runtimeThreadId !== parent.threadId || !!previous?.model && previous.model !== parent.model || (parent.connectionId && parent.connectionId !== "codex") || !!options?.connectionId && options.connectionId !== (parent.connectionId || "codex") || new Set(prefix.map(t => `${t.connectionId || "codex"}::${t.model || ""}`)).size > 1;
      if (portable) {
        // Local prefix copies below are the exact branch boundary across providers.
        seedContextId = parent.seedContextId;
      } else if (previous) {
        if (
          !parent.threadId ||
          !parent.model ||
          (!target.threadTurnId && target.state !== "failed")
        )
          throw Error("缺少可靠的线程切分位置，未创建分支。请新建会话。");
        threadId = await this.ai.fork(
          parent.model,
          parent.threadId,
          target.threadTurnId,
          previous.threadTurnId,
        );
      } else if (parent.seedContextId && prefix.length) {
        const seed = this.store.get<ContextSnapshot>(
          "context",
          parent.seedContextId,
        );
        if (!seed) throw Error("保存的探索背景已删除，请新建会话");
        const branchSeed = {
          ...structuredClone(seed),
          id: randomUUID(),
          turns: structuredClone(prefix),
          createdAt: new Date().toISOString(),
        };
        this.store.put("context", branchSeed);
        seedContextId = branchSeed.id;
      } else if (prefix.some((t) => t.answer.trim())) {
        throw Error("历史回答缺少线程标识，无法准确恢复模型记忆。请新建会话。");
      }
      if (!this.store.conversation(parent.id)) {
        if (threadId)
          this.store.put("ownedThread", { id: threadId, ownerId: parent.id });
        throw Error("原会话已删除，未创建分支");
      }
      const now = new Date().toISOString(),
        conversationId = randomUUID();
      const child: Conversation = {
        id: conversationId,
        documentId: parent.documentId,
        courseId: parent.courseId,
        documentName: parent.documentName,
        seedContextId,
        title: `${autoTitle(question ?? target.question)} · 分支`,
        titleEdited: true,
        model: parent.model,
        connectionId: options?.connectionId || parent.connectionId || "codex",
        threadId,
        parentConversationId: parent.id,
        branchTurnId: id,
        createdAt: now,
        updatedAt: now,
      };
      if (threadId)
        this.store.put("ownedThread", { id: threadId, ownerId: child.id });
      const ids = new Map(prefix.map((t) => [t.id, randomUUID()]));
      const cloned = prefix.map((t) => ({
        ...structuredClone(t),
        id: ids.get(t.id)!,
        conversationId,
        originTurnId: t.originTurnId || t.id,
        requestId: undefined,
        snapshot: {
          ...structuredClone(t.snapshot),
          conversationId,
          replyTurnId: t.snapshot.replyTurnId
            ? ids.get(t.snapshot.replyTurnId)
            : undefined,
        },
      }));
      const next: Turn = {
        ...structuredClone(target),
        id: randomUUID(),
        conversationId,
        question: question ?? target.question,
        answer: "",
        state: "preparing",
        error: undefined,
        tools: [],
        toolSources: [],
        tokenUsage: undefined,
        threadTurnId: undefined,
        requestId,
        originTurnId: target.originTurnId || target.id,
        createdAt: now,
        snapshot: {
          ...structuredClone(target.snapshot),
          ...options,
          aiContext: undefined,
          assistantSnapshot: options?.assistantId ? undefined : target.snapshot.assistantSnapshot,
          reasoningEffort: options
            ? options.reasoningEffort
            : target.snapshot.reasoningEffort,
          conversationId,
          replyTurnId: target.snapshot.replyTurnId
            ? ids.get(target.snapshot.replyTurnId)
            : undefined,
          contextSnapshotId: seedContextId,
        },
      };
      this.transaction(() => {
        this.store.put("conversation", child);
        for (const t of cloned) this.store.put("turn", t);
        this.store.put("turn", next);
        this.saveRequest(requestId, signature, next);
      });
      this.publish(next);
      const count =
        1 +
        Number(!!next.snapshot.rect) +
        next.snapshot.extraPages.filter((p) => p !== next.snapshot.page).length;
      void this.execute(next, next.snapshot.images.length === count);
      return next;
    } catch (e) {
      this.store.put<RequestRecord>("chatRequest", {
        id: requestId,
        signature,
        state: "failed",
        error: String(e instanceof Error ? e.message : e),
      });
      throw e;
    } finally {
      this.branchLocks.delete(parent.id);
    }
  }
  async reconcile(t: Turn) {
    const c = this.conversation(t.conversationId);
    if (!c.threadId || !t.threadTurnId) return;
    const saved = await this.ai.readTurn(c.threadId, t.threadTurnId);
    if (saved?.status === "completed") {
      const messages = saved.items.filter(
        (x: any) => x.type === "agentMessage",
      );
      const finals = messages.filter((x: any) => x.phase === "final_answer");
      const answer = (finals.length ? finals : messages)
        .map((x: any) => x.text)
        .join("\n\n");
      if (answer.trim()) {
        t.answer = answer;
        t.state = "completed";
        t.error = undefined;
      }
    } else if (saved?.status === "failed" || saved?.status === "interrupted") {
      t.state = saved.status === "failed" ? "failed" : "stopped";
      t.error = saved.error?.message;
    }
    this.publish(t);
  }
  async retry(id: string, requestId?: string) {
    const t = this.store.turn(id);
    if (!t) throw Error("问题不存在");
    // A repeated network request must return its earlier outcome even if reconciliation changed the source state.
    if (requestId && this.store.get<RequestRecord>("chatRequest", requestId))
      return this.branch(id, undefined, requestId);
    if (!["failed", "stopped", "unknown"].includes(t.state))
      throw Error("仅可重试失败或中断的问题");
    if (t.state === "unknown") {
      await this.reconcile(t);
      if ((t as Turn).state === "completed") return t;
      if (t.state === "unknown")
        throw Error("结果仍未确认，请检查连接后重试核对。");
    }
    return this.branch(id, undefined, requestId);
  }
}
