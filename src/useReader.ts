import { useEffect, useRef, useState } from "react";
import { api, bootstrap } from "./api.ts";
import { useChatDraft } from "./useChatDraft.ts";
import { useAIConfig } from "./useAIConfig.ts";
import { sourceMap } from "../shared/chat.ts";
import { readingDocumentId } from "./courseSelection.ts";
import { workspaceLabels, type WorkspaceView } from "./workspace.ts";
import {
  activeStates,
  type Document,
  type Conversation,
  type Turn,
  type Rect,
  type Scope,
  type QuestionSnapshot,
  type ImportJob,
  type AIModel,
  type Course,
  type Source,
  type SelectionRef,
} from "../shared/types.ts";
export function useReader() {
  const [pageArrival, setPageArrival] = useState<{
    documentId: string;
    page: number;
    edge: "top" | "bottom";
  }>();
  const [workspaceView, setWorkspaceViewState] = useState<WorkspaceView>(() => {
    const saved = localStorage.getItem("pointer-workspace-view");
    return saved && Object.hasOwn(workspaceLabels, saved)
      ? (saved as WorkspaceView)
      : "reading";
  });
  const setWorkspaceView = (view: WorkspaceView) => {
    localStorage.setItem("pointer-workspace-view", view);
    setWorkspaceViewState(view);
  };
  const [ready, setReady] = useState(false),
    [documents, setDocuments] = useState<Document[]>([]),
    [requestedDocId, setDocId] = useState(
      localStorage.getItem("lecture-last-doc") || "",
    ),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [conversationId, setConversationId] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]);
  const [courses, setCourses] = useState<Course[]>([]),
    [courseId, setCourseIdState] = useState(
      localStorage.getItem("pointer-course") || "",
    );
  const [restoredCourse, setRestoredCourse] = useState("");
  const course = courses.find((c) => c.id === courseId);
  const docId = readingDocumentId(documents, courseId, course, requestedDocId);
  const setCourseId = (id: string) => {
    localStorage.setItem("pointer-course", id);
    setCourseIdState(id);
    if (id !== courseId) setRestoredCourse("");
  };
  const contextKey = courseId ? `course-${courseId}` : docId;
  const conversationListUrl = courseId
    ? `/conversations?courseId=${courseId}`
    : `/documents/${docId}/conversations`;
  const conversationCreateUrl = courseId
    ? `/courses/${courseId}/conversations`
    : `/documents/${docId}/conversations`;
  const [auth, setAuth] = useState<any>({}),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(false),
    [preview, setPreview] = useState(false),
    [image, setImage] = useState(""),
    [searchText, setSearchText] = useState(""),
    [results, setResults] = useState<{ page: number; text: string }[]>([]),
    [searchOpen, setSearchOpen] = useState(false),
    [rail, setRail] = useState(true);
  const [pointerMode, setPointerMode] = useState<"read" | "box">("read");
  const boxMode = pointerMode !== "read",
    setBoxMode = (v: boolean) => setPointerMode(v ? "box" : "read");
  const [sourceHighlight, setSourceHighlight] = useState<{
    documentId: string;
    page: number;
    rect: Rect;
    rects?: Rect[];
  }>();
  useEffect(() => {
    if (!sourceHighlight) return;
    const timer = setTimeout(() => setSourceHighlight(undefined), 2000);
    return () => clearTimeout(timer);
  }, [sourceHighlight]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const [connectionLost, setConnectionLost] = useState(false);
  const [models, setModels] = useState<AIModel[]>([]),
    [modelError, setModelError] = useState("");
  const loadModels = async () => {
    try {
      setModels(await api<AIModel[]>("/models"));
      setModelError("");
    } catch (e: any) {
      setModelError(e.message);
    }
  };
  const ai = useAIConfig(ready, () => { void loadModels(); });
  useEffect(() => {
    if (auth.authenticated) void loadModels();
  }, [auth.authenticated]);
  const [loginUrl, setLoginUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const doc = documents.find((d) => d.id === docId),
    active = turns.find((t) => activeStates.includes(t.state)),
    last = turns.at(-1),
    conversation = conversations.find((c) => c.id === conversationId);
  const canChat = !!doc && (!courseId || !!course?.documentIds.length);
  const currentDoc = useRef(docId);
  const currentConversation = useRef(conversationId);
  currentDoc.current = docId;
  currentConversation.current = conversationId;
  const refreshConversations = async () => {
    const list = await api<Conversation[]>(conversationListUrl);
    if (currentContext.current === contextKey) setConversations(list);
  };
  useEffect(() => {
    if (last && !activeStates.includes(last.state))
      void refreshConversations().catch(() => {});
  }, [last?.id, last?.state]);
  const chat = useChatDraft(
    doc,
    conversationId,
    active,
    async (turn, submittedConversation) => {
      if (currentContext.current !== contextKey) return;
      await refreshConversations();
      if (currentConversation.current === submittedConversation) {
        if (turn.conversationId !== submittedConversation)
          setConversationId(turn.conversationId);
        else
          setTurns((ts) =>
            ts.some((t) => t.id === turn.id) ? ts : [...ts, turn],
          );
        setPreview(false);
      }
    },
    setError,
    courseId,
    { connectionId: conversation?.connectionId || ai.config?.preferences.defaultConnectionId, model: conversation?.model },
  );
  const patchConversation = async (
    id: string,
    patch: Partial<Conversation>,
  ) => {
    const c = await api<Conversation>(`/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (
      c.courseId === courseId ||
      (!courseId && currentDoc.current === c.documentId)
    )
      setConversations((cs) => cs.map((old) => (old.id === id ? c : old)));
  };
  const refreshDocs = async () => setDocuments(await api("/documents"));
  const coursesVersion = useRef(0);
  const receiveCourses = (value: Course[]) => {
    coursesVersion.current++;
    setCourses(value);
  };
  const refreshCourses = async () => {
    const version = ++coursesVersion.current;
    const value = await api<Course[]>("/courses");
    if (version === coursesVersion.current) setCourses(value);
  };
  const checkAuth = async () => {
    const status = await api("/auth");
    setAuth(status);
    if (status.authenticated) { setLoginUrl(""); await loadModels(); }
  };
  const requireAI = () => {
    if (auth.authenticated || ai.config?.connections.some(c => c.enabled && c.protocol !== "codex" && c.models.length)) return true;
    window.dispatchEvent(new CustomEvent("pointer:connect"));
    return false;
  };
  useEffect(() => {
    if (!ready) return;
    const refresh = () => { if (document.visibilityState === "visible") void checkAuth().catch(() => {}); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [ready]);
  useEffect(() => {
    void bootstrap()
      .then(async () => {
        await refreshDocs();
        await refreshCourses();
        setReady(true);
        void checkAuth();
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (ready && docId !== requestedDocId) setDocId(docId);
  }, [ready, docId, requestedDocId]);
  useEffect(() => {
    if (!ready || !course || restoredCourse === course.id) return;
    let position = course.readingPosition;
    try {
      const local = JSON.parse(localStorage.getItem("pointer-position-" + course.id) || "null");
      if (local && (!position || local.updatedAt > position.updatedAt)) position = local;
    } catch {}
    const target = position && course.documentIds.includes(position.documentId) ? position.documentId : course.documentIds[0];
    if (target) {
      setDocId(target);
      if (position?.documentId === target) setDocuments(ds => ds.map(d => d.id === target ? { ...d, page: Math.max(1, Math.min(d.pages, position!.page)) } : d));
    }
    setRestoredCourse(course.id);
  }, [ready, course?.id, restoredCourse]);
  const positionQueue = useRef(new Map<string, Promise<unknown>>());
  useEffect(() => {
    if (!ready || !course || !doc || restoredCourse !== course.id || !course.documentIds.includes(doc.id)) return;
    const position = { documentId: doc.id, page: doc.page, updatedAt: new Date().toISOString() };
    localStorage.setItem("pointer-position-" + course.id, JSON.stringify(position));
    const key = course.id;
    const next = (positionQueue.current.get(key) || Promise.resolve()).catch(() => {}).then(() => api(`/courses/${key}`, { method: "PATCH", body: JSON.stringify({ readingPosition: position }) }));
    positionQueue.current.set(key, next);
    void next.catch(() => {});
  }, [ready, courseId, docId, doc?.page, restoredCourse]);
  const courseDocuments = courses.flatMap((c) => c.documentIds).join(",");
  useEffect(() => {
    if (ready) void refreshDocs().catch(() => {});
  }, [ready, courseDocuments]);
  useEffect(() => {
    if (!documents.some((d) => d.indexStatus === "indexing")) return;
    const timer = setInterval(() => void refreshDocs().catch(() => {}), 1500);
    return () => clearInterval(timer);
  }, [documents]);
  useEffect(() => {
    if (!ready) return;
    if (!canChat) {
      setConversationId("");
      setTurns([]);
      setConversations([]);
      return;
    }
    let cancelled = false;
    localStorage.setItem("lecture-last-doc", docId);
    setConversationId("");
    setTurns([]);
    setConversations([]);
    setResults([]);
    setSearchText("");
    setSearched(false);
    setPreview(false);
    void api<Conversation[]>(conversationListUrl)
      .then(async (list) => {
        if (!list.some((c) => !c.archived))
          list = [
            ...list,
            await api(conversationCreateUrl, {
              method: "POST",
              body: JSON.stringify({
                documentId:
                  course && !course.documentIds.includes(docId)
                    ? course.documentIds[0]
                    : docId,
              }),
            }),
          ];
        if (cancelled) return;
        setConversations(list);
        const saved = localStorage.getItem(`lecture-conv-${contextKey}`);
        setConversationId(
          list.find((c) => c.id === saved && !c.archived)?.id ||
            list.find((c) => !c.archived)!.id,
        );
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [contextKey, ready, canChat]);
  useEffect(() => {
    if (!ready || !doc) return;
    localStorage.setItem("lecture-last-doc", doc.id);
    void api(`/documents/${doc.id}/recent`, {
      method: "POST",
      body: JSON.stringify({ hidden: false }),
    })
      .then((updated: Document) =>
        setDocuments((ds) =>
          ds.map((d) =>
            d.id === updated.id
              ? { ...d, hiddenRecent: false, openedAt: updated.openedAt }
              : d,
          ),
        ),
      )
      .catch(() => {});
    setResults([]);
    setSearchText("");
    setSearched(false);
    setPreview(false);
  }, [docId, ready]);
  useEffect(() => {
    if (!conversationId) return;
    localStorage.setItem(`lecture-conv-${contextKey}`, conversationId);
    setTurns([]);
    let stream: EventSource,
      closed = false,
      timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      if (closed) return;
      setConnectionLost(true);
      stream?.close();
      timer = setTimeout(() => {
        void bootstrap()
          .then(() => {
            if (!closed) connect();
          })
          .catch(retry);
      }, 2000);
    };
    const connect = () => {
      stream = new EventSource(`/api/conversations/${conversationId}/events`);
      stream.onopen = () => setConnectionLost(false);
      stream.onmessage = (e) => {
        if (
          currentContext.current === contextKey &&
          currentConversation.current === conversationId
        )
          setTurns(JSON.parse(e.data));
      };
      stream.onerror = retry;
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      stream?.close();
    };
  }, [conversationId]);
  const change = (patch: Partial<Document>) => {
    if (!doc) return;
    const updated = { ...doc, ...patch };
    setDocuments((ds) => ds.map((d) => (d.id === docId ? updated : d)));
    void api(`/documents/${docId}`, {
      method: "PATCH",
      body: JSON.stringify({
        page: updated.page,
        rotation: updated.rotation,
        zoom: updated.zoom,
        fitMode: updated.fitMode,
      }),
    }).catch((e) => setError(e.message));
  };
  const go = (page: number, edge: "top" | "bottom" = "top") => {
    if (!doc) return;
    const next = Math.max(1, Math.min(doc.pages, page));
    if (next === doc.page) return;
    setPageArrival({ documentId: doc.id, page: next, edge });
    change({ page: next });
  };
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [office, setOffice] = useState({
    powerpoint: false,
    libreoffice: false,
  });
  const completed = useRef(new Set<string>());
  const watched = useRef(new Set<string>());
  const importCourses = useRef(new Map<string, string>());
  const refreshJobs = async () => {
    const list = await api<ImportJob[]>("/imports");
    setJobs(list);
    if (list.some((j) => j.state === "completed" && !completed.current.has(j.id))) {
      await refreshDocs();
      await refreshCourses();
    }
    for (const j of list)
      if (
        j.state === "completed" &&
        watched.current.has(j.id) &&
        !completed.current.has(j.id)
      ) {
        completed.current.add(j.id);
        await refreshDocs();
        if (j.documentId) {
          const destination =
            importCourses.current.get(j.id) ||
            localStorage.getItem("pointer-import-course-" + j.id);
          if (destination) {
            try {
              const target = (await api<Course[]>("/courses")).find(
                (c) => c.id === destination,
              );
              if (!target) throw Error("课程已不存在");
              if (!target.documentIds.includes(j.documentId))
                await api("/courses/" + destination, {
                  method: "PATCH",
                  body: JSON.stringify({
                    documentIds: [...target.documentIds, j.documentId],
                    selectedDocumentIds: [
                      ...target.selectedDocumentIds,
                      j.documentId,
                    ],
                  }),
                });
              await refreshCourses();
            } catch (e) {
              setError(
                "课件已导入资料库，加入课程失败：" + (e as Error).message,
              );
            }
          }
          if (
            (!destination && currentContext.current === contextKey && !courseId) ||
            currentContext.current === "course-" + destination
          )
            setDocId(j.documentId);
          importCourses.current.delete(j.id);
          localStorage.removeItem("pointer-import-course-" + j.id);
        }
      }
    for (const j of list) if (j.state === "completed") completed.current.add(j.id);
  };
  useEffect(() => {
    if (!ready) return;
    void api("/office")
      .then(setOffice)
      .catch(() => {});
    void api<ImportJob[]>("/imports").then((list) => {
      setJobs(list);
      list.filter((j) => j.state === "completed" && !localStorage.getItem("pointer-import-course-" + j.id))
        .forEach((j) => completed.current.add(j.id));
      list
        .filter(
          (j) =>
            localStorage.getItem("pointer-import-course-" + j.id),
        )
        .forEach((j) => watched.current.add(j.id));
      if (
        list.some(
          (j) =>
            j.state === "completed" &&
            localStorage.getItem("pointer-import-course-" + j.id),
        )
      )
        void refreshJobs();
    });
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refreshJobs(); } catch {}
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [ready, contextKey]);
  const importFile = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const job = await api<ImportJob>("/imports", {
        method: "POST",
        body: form,
      });
      if (courseId) {
        importCourses.current.set(job.id, courseId);
        localStorage.setItem("pointer-import-course-" + job.id, courseId);
      }
      watched.current.add(job.id);
      await refreshJobs();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const retryImport = async (id: string, engine?: string) => {
    watched.current.add(id);
    completed.current.delete(id);
    await api("/imports/" + id + "/retry", {
      method: "POST",
      body: JSON.stringify({ engine }),
    });
    await refreshJobs();
  };
  const newConversation = async () => {
    if (!doc) return;
    const c = await api<Conversation>(conversationCreateUrl, {
      method: "POST",
      body: JSON.stringify({ documentId: doc.id }),
    });
    if (currentContext.current !== contextKey) return;
    setConversations((cs) => [...cs, c]);
    setConversationId(c.id);
  };
  const sources = sourceMap(turns);
  const navigateSource = (page: number, documentId = docId, rect?: Rect, rects?: Rect[]) => {
    const target = documents.find((d) => d.id === documentId);
    if (!target) {
      setError("来源已删除，旧问答与已发送材料仍保留。");
      return;
    }
    setWorkspaceView("reading");
    setPageArrival({ documentId, page, edge: "top" });
    setDocuments((ds) =>
      ds.map((d) => (d.id === documentId ? { ...d, page } : d)),
    );
    setDocId(documentId);
    setSourceHighlight(rect ? { documentId, page, rect, rects } : undefined);
    void api(`/documents/${documentId}`, {
      method: "PATCH",
      body: JSON.stringify({
        page,
        rotation: target.rotation,
        zoom: target.zoom,
        fitMode: target.fitMode,
      }),
    }).catch((e) => setError(e.message));
  };
  const addReference = async (selection: SelectionRef) => {
    if ((chat.chatDraft.selections || []).length >= 6)
      throw Error("每次最多引用六个选区，请先发送或移除部分引用");
    const saved = await api<SelectionRef>("/selections", {
      method: "POST",
      body: JSON.stringify({ selection, conversationId }),
    });
    chat.patchDraft((d) => ({
      selections: [...(d.selections || []), saved],
      pinned: d.selections?.length
        ? d.pinned
        : {
            page: saved.page,
            rotation: saved.rotation,
            documentId: saved.documentId,
          },
      selectedText: d.selections?.length ? d.selectedText : saved.text,
      rect: d.selections?.length ? d.rect : saved.rect,
    }));
  };
  const removeReference = async (id: string) => {
    chat.patchDraft((d) => {
      const selections = (d.selections || []).filter((s) => s.id !== id),
        first = selections[0];
      return {
        selections,
        pinned: first
          ? {
              page: first.page,
              rotation: first.rotation,
              documentId: first.documentId,
            }
          : undefined,
        rect: first?.rect,
        selectedText: first?.text || "",
      };
    });
    await api(`/selections/${id}`, { method: "DELETE" });
  };
  const deleteConversation = async (id: string) => {
    await api(`/conversations/${id}`, { method: "DELETE" });
    for (const key of Object.keys(localStorage))
      if (
        (key.startsWith("lecture-draft-") ||
          key.startsWith("lecture-action-")) &&
        key.includes(id)
      )
        localStorage.removeItem(key);
    await refreshConversations();
    if (id === conversationId) await newConversation();
  };
  const [searched, setSearched] = useState(false);
  const runSearch = async () => {
    if (!doc || !searchText.trim()) return;
    try {
      const found = await api(
        `/documents/${doc.id}/search?q=${encodeURIComponent(searchText)}`,
      );
      if (currentDoc.current !== doc.id) return;
      setResults(found);
      setSearchOpen(true);
      setSearched(true);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const guard = (f: () => Promise<unknown>) =>
    void f().catch((e) => setError(e.message));
  return {
    ...chat,
    send: async () => { if (requireAI()) await chat.send(); },
    requireAI,
    workspaceView,
    setWorkspaceView,
    courses,
    course,
    courseId,
    setCourseId,
    setCourses: receiveCourses,
    refreshCourses,
    refreshDocs,
    pageArrival,
    pointerMode,
    setPointerMode,
    sourceHighlight,
    navigateSource,
    addReference,
    removeReference,
    deleteConversation,
    conversationListUrl,
    models,
    ai,
    modelError,
    loadModels,
    ready,
    documents,
    docId,
    setDocId,
    doc,
    conversations,
    conversation,
    patchConversation,
    refreshConversations,
    conversationId,
    setConversationId,
    turns,
    active,
    last,
    auth,
    checkAuth,
    loginUrl,
    setLoginUrl,
    connectionLost,
    error,
    setError,
    importing,
    importFile,
    jobs,
    office,
    refreshJobs,
    retryImport,
    boxMode,
    setBoxMode,
    preview,
    setPreview,
    image,
    setImage,
    searchText,
    setSearchText,
    results,
    searchOpen,
    setSearchOpen,
    searched,
    rail,
    setRail,
    fileInput,
    change,
    go,
    sources,
    runSearch,
    guard,
    newConversation,
  };
}
export type Reader = ReturnType<typeof useReader>;
