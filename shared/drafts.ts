import type { AnswerLength, Rect, Scope, SelectionRef } from "./types.ts";
export interface ChatDraft {
  question: string;
  scope: Scope;
  answerLength: AnswerLength;
  model?: string;
  connectionId?: string;
  assistantId?: string;
  textOnly?: boolean;
  reasoningEffort?: string;
  agentTools?: boolean;
  webSearch?: boolean;
  extraPages: number[];
  selectedText: string;
  rect?: Rect;
  pinned?: { page: number; rotation: number; documentId?: string };
  selections?: SelectionRef[];
  replyTurnId?: string;
  editTurnId?: string;
  request?: { signature: string; id: string };
  revision: number;
}
export const emptyDraft = (): ChatDraft => ({
  question: "",
  scope: "page",
  answerLength: "standard",
  agentTools: true,
  webSearch: false,
  extraPages: [],
  selectedText: "",
  revision: 0,
  selections: [],
});
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export class DraftStore {
  private values = new Map<string, ChatDraft>();
  private listeners = new Set<() => void>();
  error = "";
  constructor(private storage?: StorageLike) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  get = (key: string): ChatDraft => {
    if (!this.values.has(key)) {
      let d = emptyDraft();
      try {
        const saved = JSON.parse(this.storage?.getItem(key) || "null");
        if (
          saved &&
          typeof saved.question === "string" &&
          Array.isArray(saved.extraPages)
        )
          d = { ...d, ...saved, connectionId: saved.connectionId || (saved.model ? "codex" : undefined) };
      } catch {
        this.error = "无法恢复这份草稿。";
      }
      this.values.set(key, d);
    }
    return this.values.get(key)!;
  };
  update(
    key: string,
    patch: Partial<ChatDraft> | ((d: ChatDraft) => Partial<ChatDraft>),
    keepRequest = false,
  ) {
    const old = this.get(key),
      changes = typeof patch === "function" ? patch(old) : patch;
    const next = {
      ...old,
      ...changes,
      revision: old.revision + (keepRequest ? 0 : 1),
    };
    if (!keepRequest) next.request = undefined;
    this.values.set(key, next);
    try {
      this.storage?.setItem(key, JSON.stringify(next));
      this.error = "";
    } catch {
      this.error = "本地存储空间不足，草稿暂时仅保留在当前窗口。";
    }
    for (const fn of this.listeners) fn();
    return next;
  }
  clearSubmitted(key: string, revision: number) {
    const old = this.get(key);
    if (old.revision !== revision) return false;
    this.update(key, {
      ...emptyDraft(),
      pinned: undefined,
      rect: undefined,
      replyTurnId: undefined,
      editTurnId: undefined,
      scope: old.scope,
      answerLength: old.answerLength,
      model: old.model,
      connectionId: old.connectionId,
      assistantId: old.assistantId,
      textOnly: old.textOnly,
      reasoningEffort: old.reasoningEffort,
      agentTools: old.agentTools,
      webSearch: old.webSearch,
    });
    return true;
  }
}
