import { useRef, useState, useSyncExternalStore } from "react";
import { DraftStore, type ChatDraft } from "../shared/drafts.ts";
import type {
  Conversation,
  Document,
  QuestionSnapshot,
  Rect,
  Turn,
  AISettings,
} from "../shared/types.ts";
import { api } from "./api.ts";

const drafts = new DraftStore(localStorage);
export function useChatDraft(
  doc: Document | undefined,
  conversationId: string,
  active: Turn | undefined,
  onResult: (turn: Turn, submittedConversation: string) => Promise<void>,
  setError: (s: string) => void,
  courseId?: string,
  defaults: AISettings = {},
) {
  const key = `lecture-draft-v2-${courseId ? "course-" + courseId : doc?.id || "none"}-${conversationId || "none"}`;
  const data = useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
  const [sending, setSending] = useState(false);
  const pending = useRef(false),
    input = useRef<HTMLTextAreaElement>(null);
  const patch = (
    p: Partial<ChatDraft> | ((d: ChatDraft) => Partial<ChatDraft>),
  ) => drafts.update(key, p);
  const snapshot = (): Omit<QuestionSnapshot, "images" | "sources"> => ({
    documentId: data.pinned?.documentId || doc!.id,
    conversationId,
    page: data.pinned?.page || doc!.page,
    rotation: data.pinned?.rotation ?? doc!.rotation,
    selectedText: data.selectedText,
    rect: data.rect,
    scope: data.scope,
    extraPages: data.extraPages,
    answerLength: data.answerLength,
    replyTurnId: data.replyTurnId,
    model: data.model || (!data.connectionId || data.connectionId === defaults.connectionId ? defaults.model : undefined),
    connectionId: data.connectionId || defaults.connectionId,
    assistantId: data.assistantId,
    textOnly: data.textOnly,
    reasoningEffort: data.reasoningEffort || undefined,
    agentTools: data.agentTools ?? true,
    webSearch: data.webSearch ?? false,
    selections: data.selections || [],
  });
  const selectContext = (text: string, area?: Rect) => {
    if (!doc || !conversationId || (!text && !area)) return;
    patch({
      pinned: { page: doc.page, rotation: doc.rotation, documentId: doc.id },
      selectedText: text,
      rect: area,
      replyTurnId: undefined,
      editTurnId: undefined,
    });
  };
  const clearContext = () =>
    patch({
      pinned: undefined,
      selectedText: "",
      rect: undefined,
      replyTurnId: undefined,
      editTurnId: undefined,
      extraPages: [],
    });
  const followCurrentPage = () =>
    patch({
      pinned: undefined,
      selectedText: "",
      rect: undefined,
      extraPages: [],
    });
  const edit = (t: Turn) => {
    patch({
      question: t.question,
      pinned: {
        page: t.snapshot.page,
        rotation: t.snapshot.rotation,
        documentId: t.snapshot.documentId,
      },
      selectedText: t.snapshot.selectedText,
      rect: t.snapshot.rect,
      scope: t.snapshot.scope,
      extraPages: t.snapshot.extraPages,
      answerLength: t.snapshot.answerLength || "standard",
      model: t.model || t.snapshot.model,
      connectionId: t.connectionId || t.snapshot.connectionId || "codex",
      assistantId: t.snapshot.assistantId,
      textOnly: t.snapshot.textOnly,
      reasoningEffort: t.reasoningEffort || t.snapshot.reasoningEffort,
      agentTools: t.snapshot.agentTools ?? true,
      webSearch: t.snapshot.webSearch ?? false,
      editTurnId: t.id,
      replyTurnId: t.snapshot.replyTurnId,
      selections: t.snapshot.selections || [],
    });
    input.current?.focus();
  };
  const followup = (t: Turn, text = "") => {
    patch({
      question: text || data.question,
      pinned: {
        page: t.snapshot.page,
        rotation: t.snapshot.rotation,
        documentId: t.snapshot.documentId,
      },
      selectedText: t.snapshot.selectedText,
      rect: t.snapshot.rect,
      scope: t.snapshot.scope,
      extraPages: t.snapshot.extraPages,
      replyTurnId: t.id,
      editTurnId: undefined,
      selections: t.snapshot.selections || [],
    });
    input.current?.focus();
  };
  const send = async () => {
    if (
      !doc ||
      !conversationId ||
      !data.question.trim() ||
      active ||
      pending.current
    )
      return;
    const frozen = structuredClone(snapshot()),
      question = data.question.trim(),
      revision = data.revision;
    const signature = JSON.stringify({
      question,
      snapshot: frozen,
      editTurnId: data.editTurnId,
    });
    const requestId =
      data.request?.signature === signature
        ? data.request.id
        : crypto.randomUUID();
    drafts.update(key, { request: { signature, id: requestId } }, true);
    pending.current = true;
    setSending(true);
    setError("");
    try {
      const turn = await api<Turn>(
        data.editTurnId ? `/turns/${data.editTurnId}/branch` : "/turns",
        {
          method: "POST",
          body: JSON.stringify({
            question,
            snapshot: frozen,
            requestId,
            options: data.editTurnId
              ? {
                  model: frozen.model,
                  connectionId: frozen.connectionId,
                  assistantId: frozen.assistantId,
                  textOnly: frozen.textOnly,
                  reasoningEffort: frozen.reasoningEffort,
                  agentTools: frozen.agentTools,
                  webSearch: frozen.webSearch,
                  answerLength: frozen.answerLength,
                }
              : undefined,
          }),
        },
      );
      const cleared = drafts.clearSubmitted(key, revision);
      if (cleared)
        for (const ref of frozen.selections || [])
          void api(`/selections/${ref.id}`, { method: "DELETE" }).catch(
            () => {},
          );
      await onResult(turn, conversationId);
    } catch (e: any) {
      if (e.status) drafts.update(key, { request: undefined }, true);
      setError(e.message);
    } finally {
      pending.current = false;
      setSending(false);
    }
  };
  const retry = async (t: Turn, mode: "branch" | "retry") => {
    if (active || pending.current) return;
    pending.current = true;
    setSending(true);
    setError("");
    // Keep the key across uncertain network failures, and across reloads.
    const options =
      mode === "branch"
        ? {
            model: data.model || t.model,
            reasoningEffort: data.reasoningEffort,
            agentTools: data.agentTools ?? true,
            webSearch: data.webSearch ?? false,
            answerLength: data.answerLength,
          }
        : undefined;
    const reqKey = `lecture-action-${t.id}-${mode}-${JSON.stringify(options)}`;
    let requestId = sessionStorage.getItem(reqKey) || crypto.randomUUID();
    sessionStorage.setItem(reqKey, requestId);
    try {
      const turn = await api<Turn>(`/turns/${t.id}/${mode}`, {
        method: "POST",
        body: JSON.stringify({ requestId, options }),
      });
      sessionStorage.removeItem(reqKey);
      await onResult(turn, conversationId);
    } catch (e: any) {
      // HTTP errors have a known outcome. A transport failure retains the idempotency key.
      if (e.status) sessionStorage.removeItem(reqKey);
      setError(e.message);
    } finally {
      pending.current = false;
      setSending(false);
    }
  };
  return {
    chatDraft: data,
    patchDraft: patch,
    draft: doc && conversationId ? snapshot() : undefined,
    question: data.question,
    setQuestion: (question: string) => patch({ question }),
    selectedText: data.selectedText,
    rect:
      data.pinned?.page === doc?.page &&
      (!data.pinned?.documentId || data.pinned?.documentId === doc?.id)
        ? data.rect
        : undefined,
    setRect: (rect?: Rect) => patch({ rect }),
    scope: data.scope,
    extraPages: data.extraPages,
    setExtraPages: (fn: number[] | ((p: number[]) => number[])) =>
      patch((d) => ({
        extraPages: typeof fn === "function" ? fn(d.extraPages) : fn,
      })),
    selectContext,
    clearContext,
    followCurrentPage,
    edit,
    followup,
    send,
    retry,
    input,
    sending,
    draftError: drafts.error,
  };
}
