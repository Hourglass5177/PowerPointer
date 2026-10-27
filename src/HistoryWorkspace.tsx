import { useEffect, useState } from "react";
import type { Reader } from "./useReader.ts";
import { api } from "./api.ts";
import type { Conversation, Turn } from "../shared/types.ts";
import { sourceMap } from "../shared/chat.ts";
import { RichAnswer } from "./RichAnswer.tsx";
export function HistoryWorkspace({ r }: { r: Reader }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<Conversation[]>([]),
    [query, setQuery] = useState(""),
    [historyCourse, setHistoryCourse] = useState(r.courseId),
    [historyDoc, setHistoryDoc] = useState(""),
    [view, setView] = useState<{ conversation: Conversation; turns: Turn[] }>();
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loadHistory = async () => {
    setHistory(
      await api<Conversation[]>(
        `/conversations?q=${encodeURIComponent(query)}&courseId=${historyCourse}&documentId=${historyDoc}`,
      ),
    );
  };
  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(
      () =>
        void api<Conversation[]>(
          `/conversations?q=${encodeURIComponent(query)}&courseId=${historyCourse}&documentId=${historyDoc}`,
        )
          .then((v) => !cancelled && setHistory(v))
          .catch((e) => !cancelled && setMessage(e.message))
          .finally(() => !cancelled && setLoading(false)),
      180,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, historyCourse, historyDoc]);
  useEffect(() => {
    setHistoryCourse(r.courseId);
    setHistoryDoc("");
    setView(undefined);
  }, [r.courseId]);
  const continueChat = async (c: Conversation) => {
    if (c.archived) await r.patchConversation(c.id, { archived: false });
    const key = c.courseId ? "course-" + c.courseId : c.documentId;
    localStorage.setItem("lecture-conv-" + key, c.id);
    const nextDoc =
      r.documents.find((d) => d.id === c.documentId) ||
      r.documents.find((d) =>
        r.courses.find((x) => x.id === c.courseId)?.documentIds.includes(d.id),
      );
    r.setCourseId(c.courseId || "");
    if (nextDoc) r.setDocId(nextDoc.id);
    if (
      (c.courseId || "") === r.courseId &&
      (c.courseId || c.documentId === r.docId)
    )
      r.setConversationId(c.id);
    r.setWorkspaceView("reading");
  };
  const navigate = (page: number, id?: string) => r.navigateSource(page, id);
  return (
    <main className="workspace-page history-page" aria-busy={loading}>
      <header className="page-heading">
        <h1>历史</h1>
      </header>
      {message && <p role="status">{message}</p>}{" "}
      <div className="history-filters">
        <input
          aria-label="搜索全部会话"
          placeholder="搜索标题或问答"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="按课程筛选历史"
          value={historyCourse}
          onChange={(e) => setHistoryCourse(e.target.value)}
        >
          <option value="">全部课程</option>
          {r.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="按课件筛选历史"
          value={historyDoc}
          onChange={(e) => setHistoryDoc(e.target.value)}
        >
          <option value="">全部课件（含已删除来源）</option>
          {r.documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      {history
        .slice()
        .reverse()
        .map((c) => (
          <div className="library-history-row" key={c.id}>
            <button
              onClick={() =>
                void perform(async () =>
                  setView({
                    conversation: c,
                    turns: await api(`/conversations/${c.id}/turns`),
                  }),
                )
              }
            >
              <strong>{c.title}</strong>
              <small>
                {r.courses.find((x) => x.id === c.courseId)?.name ||
                  c.documentName ||
                  r.documents.find((d) => d.id === c.documentId)?.name ||
                  "来源已删除"}
                {c.archived ? " · 已归档" : ""}
              </small>
            </button>
            <button
              disabled={
                busy ||
                (!r.documents.some((d) => d.id === c.documentId) && !c.courseId)
              }
              onClick={() => void perform(() => continueChat(c))}
            >
              {c.archived ? "恢复并继续" : "继续"}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await r.patchConversation(c.id, { archived: !c.archived });
                  await loadHistory();
                })
              }
            >
              {c.archived ? "取消归档" : "归档"}
            </button>
            <button
              onClick={() =>
                void perform(async () => {
                  const impact = await api<{ turns: number }>(
                    `/conversations/${c.id}/impact`,
                  );
                  if (
                    confirm(
                      `删除“${c.title}”和 ${impact.turns} 条问答？其他分支与已打开解释窗保留。`,
                    )
                  ) {
                    await r.deleteConversation(c.id);
                    await loadHistory();
                    if (view?.conversation.id === c.id) setView(undefined);
                  }
                })
              }
            >
              删除
            </button>
          </div>
        ))}
      {view && (
        <section className="history-view">
          <div className="course-section-heading">
            <h3>{view.conversation.title}</h3>
            <a
              href={`/api/conversations/${view.conversation.id}/export`}
              download
            >
              导出
            </a>
            <button onClick={() => setView(undefined)}>收起</button>
          </div>
          {view.turns.map((t) => (
            <article className="answer answer-v2" key={t.id}>
              <h4>{t.question}</h4>
              <RichAnswer
                text={t.answer}
                sources={sourceMap(view.turns)}
                navigate={navigate}
              />
            </article>
          ))}
        </section>
      )}
      {!loading && !history.length && (
        <div className="workspace-empty">
          <h2>暂无会话</h2>
          <p>阅读中的问答会保存在这里。</p>
        </div>
      )}
    </main>
  );
}
