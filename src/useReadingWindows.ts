import { useEffect, useRef, useState } from "react";
import { api, bootstrap } from "./api.ts";
import type { Reader } from "./useReader.ts";
import {
  type AISettings,
  type Conversation,
  type Course,
  type ReadingSession,
  type SelectionRef,
  type Turn,
  type KnowledgeChapter,
} from "../shared/types.ts";
import type { PointerRequest } from "./selection.ts";
export function useReadingWindows(r: Reader) {
  const [sessions, setSessions] = useState<ReadingSession[]>([]),
    [turns, setTurns] = useState<Turn[]>([]),
    [focused, setFocused] = useState("");
  const [notesVersion, setNotesVersion] = useState(0);
  const [connected, setConnected] = useState(true),
    [cleanup, setCleanup] = useState<{ id: string; error?: string }[]>([]);
  const [knowledgeProgress, setKnowledgeProgress] = useState<
    {
      id: string;
      courseId: string;
      state: string;
      total: number;
      completed: number;
      failed: number;
      phase?: string;
      activeDocumentId?: string;
      resultVersion: number;
      reused?: number;
      chapters: Pick<KnowledgeChapter, "documentId" | "state" | "completed" | "failed" | "total">[];
    }[]
  >([]);
  const queues = useRef(new Map<string, Promise<unknown>>()),
    closed = useRef(new Set<string>());
  const readState = (value: {
    sessions: ReadingSession[];
    turns: Turn[];
    courses?: Course[];
    cleanup?: { id: string; error?: string }[];
    knowledge?: typeof knowledgeProgress;
    notesVersion?: number;
  }) => {
    setSessions(value.sessions.filter((s) => !closed.current.has(s.id)));
    setTurns(
      value.turns.filter((t) => !closed.current.has(t.readingSessionId!)),
    );
    if (value.courses) r.setCourses(value.courses);
    if (value.cleanup) setCleanup(value.cleanup);
    if (value.knowledge) setKnowledgeProgress(value.knowledge);
    if (value.notesVersion !== undefined) setNotesVersion(value.notesVersion);
  };
  useEffect(() => {
    if (!r.ready) return;
    let stream: EventSource | undefined,
      disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      if (disposed) return;
      setConnected(false);
      stream?.close();
      timer = setTimeout(
        () =>
          void bootstrap()
            .then(() => {
              if (!disposed) connect();
            })
            .catch(retry),
        2000,
      );
    };
    const connect = () => {
      stream = new EventSource("/api/reading/events");
      stream.onopen = () => setConnected(true);
      stream.onmessage = (e) => {
        if (!disposed) readState(JSON.parse(e.data));
      };
      stream.onerror = retry;
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      stream?.close();
    };
  }, [r.ready]);
  const settings: AISettings = {
    connectionId: r.chatDraft.connectionId || r.conversation?.connectionId || r.ai.config?.preferences.defaultConnectionId,
    assistantId: r.chatDraft.assistantId,
    textOnly: r.chatDraft.textOnly,
    model:
      r.chatDraft.model ||
      r.conversation?.model ||
      r.models.find((m) => m.isDefault)?.model,
    reasoningEffort: r.chatDraft.reasoningEffort,
    agentTools: r.chatDraft.agentTools ?? true,
    webSearch: r.chatDraft.webSearch ?? false,
  };
  const patch = (
    id: string,
    changes: Partial<Pick<ReadingSession, "draft" | "layout" | "settings">>,
  ) => {
    if (closed.current.has(id)) return Promise.resolve();
    setSessions((ss) =>
      ss.map((s) => (s.id === id ? { ...s, ...changes } : s)),
    );
    const next = (queues.current.get(id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!closed.current.has(id))
          return api(`/reading/${id}`, {
            method: "PATCH",
            body: JSON.stringify(changes),
          });
      });
    queues.current.set(id, next);
    return next;
  };
  const ask = async (id: string, question: string, requestId: string) => {
    if (!r.requireAI()) throw Error("连接 ChatGPT 后可继续发送，草稿已保留。");
    await queues.current.get(id);
    const t = await api<Turn>(`/reading/${id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question, requestId }),
    });
    if (!closed.current.has(id))
      setTurns((ts) => (ts.some((x) => x.id === t.id) ? ts : [...ts, t]));
    return t;
  };
  const open = async (request: PointerRequest) => {
    if (!r.requireAI()) return;
    const id = crypto.randomUUID(),
      width = Math.min(400, window.innerWidth - 24),
      height = Math.min(440, window.innerHeight - 120);
    const x =
      request.position.x + width + 24 < window.innerWidth
        ? request.position.x + 16
        : Math.max(12, request.position.x - width - 24);
    const y = Math.max(
      100,
      Math.min(window.innerHeight - height - 16, request.position.y),
    );
    const parent = request.parentId
      ? sessions.find((s) => s.id === request.parentId)
      : undefined;
    const session = await api<ReadingSession>("/reading", {
      method: "POST",
      body: JSON.stringify({
        id,
        parentId: request.parentId,
        conversationId: r.conversationId || undefined,
        courseId: r.courseId || undefined,
        selection: request.selection,
        settings: parent?.settings || settings,
        layout: {
          x: Math.min(1, x / Math.max(1, window.innerWidth - width)),
          y: Math.min(1, y / Math.max(1, window.innerHeight - height)),
          width,
          height,
          minimized: false,
        },
      }),
    });
    setSessions((ss) => (ss.some((s) => s.id === id) ? ss : [...ss, session]));
    setFocused(id);
    await ask(
      id,
      request.selection.text
        ? `请解释“${request.selection.text.slice(0, 5000)}”。`
        : "请解释这个框选区域。",
      id,
    );
    return session;
  };
  const close = async (id: string, branch = false) => {
    const result = await api<{ closed: string[] }>(
      `/reading/${id}${branch ? "?branch=true" : ""}`,
      { method: "DELETE" },
    );
    for (const target of result.closed) {
      closed.current.add(target);
      queues.current.delete(target);
      sessionStorage.removeItem(`pointer-send-${target}`);
    }
    setSessions((ss) => ss.filter((s) => !result.closed.includes(s.id)));
    setTurns((ts) =>
      ts.filter((t) => !result.closed.includes(t.readingSessionId!)),
    );
  };
  const promote = async (id: string) => {
    const c = await api<Conversation>(`/reading/${id}/promote`, {
      method: "POST",
    });
    if (
      c.courseId === r.courseId &&
      (!c.courseId ? c.documentId === r.docId : true)
    ) {
      await r.refreshConversations();
      r.setConversationId(c.id);
    } else {
      localStorage.setItem(
        `lecture-conv-${c.courseId ? "course-" + c.courseId : c.documentId}`,
        c.id,
      );
      r.setCourseId(c.courseId || "");
      r.setDocId(c.documentId);
    }
    return c;
  };
  return {
    sessions,
    turns,
    focused,
    setFocused,
    connected,
    cleanup,
    knowledgeProgress,
    notesVersion,
    settings,
    patch,
    ask,
    open,
    close,
    promote,
  };
}
export type ReadingWindows = ReturnType<typeof useReadingWindows>;
