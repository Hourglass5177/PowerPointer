import { useEffect, useRef, useState } from "react";
import type { Reader } from "../useReader.ts";
import type { Conversation } from "../../shared/types.ts";
import { api } from "../api.ts";
import { Icon, Tool } from "../controls.tsx";

export function ChatHeader({
  r,
  expanded,
  onExpand,
  onClose,
  history,
  setHistory,
}: {
  r: Reader;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  history: boolean;
  setHistory: (v: boolean) => void;
}) {
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [results, setResults] = useState<(Conversation & { matchText?: string })[]>(
      [],
    ),
    [renameId, setRenameId] = useState(""),
    [name, setName] = useState(""),
    [loading, setLoading] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!history) return;
    search.current?.focus();
    void r.refreshConversations().catch(() => {});
  }, [history]);
  useEffect(() => {
    if (!query.trim()) {
      setResults(r.conversations);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void api<(Conversation & { matchText?: string })[]>(
        `${r.conversationListUrl}${r.conversationListUrl.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`,
      )
        .then((list) => {
          if (!cancelled) setResults(list);
        })
        .catch((e) => {
          if (!cancelled) r.setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, r.conversations, r.conversationListUrl]);
  const startRename = (c: Conversation) => {
    setRenameId(c.id);
    setName(c.title);
    setHistory(true);
    setArchived(!!c.archived);
  };
  const list = results
    .filter((c) => !!c.archived === archived)
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
    );
  return (
    <>
      <header className="chat-header">
        <button
          className="chat-title"
          onClick={() => setHistory(!history)}
          title={r.conversation?.title || "问答"}
        >
          <Icon name="chat" size={18} />
          <span>
            {r.turns.length ? r.conversation?.title || "问答" : "问答"}
          </span>
        </button>
        <div className="chat-header-actions">
          <Tool
            icon="history"
            title="会话历史"
            active={history}
            onClick={() => setHistory(!history)}
          />
          <Tool
            icon="plus"
            title="新建会话"
            onClick={() => {
              setHistory(false);
              r.guard(r.newConversation);
            }}
          />
          <Tool
            icon={expanded ? "collapse" : "expand"}
            title={expanded ? "恢复解释宽度" : "展开解释"}
            onClick={onExpand}
          />
          <details className="popover chat-more">
            <summary aria-label="会话更多操作">
              <Icon name="more" />
            </summary>
            <div className="popover-panel">
              <button
                disabled={!r.conversation}
                onClick={(e) => {
                  if (r.conversation) startRename(r.conversation);
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                重命名会话
              </button>
              {r.conversationId && (
                <a
                  href={`/api/conversations/${r.conversationId}/export`}
                  download
                >
                  <Icon name="download" size={16} />
                  导出 Markdown
                </a>
              )}
            </div>
          </details>
          <Tool icon="close" title="收起问答" onClick={onClose} />
        </div>
      </header>
      {history && (
        <div className="chat-history" role="region" aria-label="会话历史列表">
          <div className="history-heading">
            <strong>会话历史</strong>
            <button aria-label="返回对话" onClick={() => setHistory(false)}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="history-search">
            <Icon name="search" size={16} />
            <input
              ref={search}
              aria-label="搜索会话标题与消息"
              placeholder="搜索标题与消息"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="history-tabs">
            <button
              className={!archived ? "selected" : ""}
              onClick={() => setArchived(false)}
            >
              最近
            </button>
            <button
              className={archived ? "selected" : ""}
              onClick={() => setArchived(true)}
            >
              已归档
            </button>
          </div>
          <div className="history-list">
            {loading ? (
              <p className="chat-muted">正在搜索…</p>
            ) : !list.length ? (
              <p className="chat-muted">
                {query
                  ? "没有找到匹配的会话"
                  : archived
                    ? "没有归档会话"
                    : "暂无会话"}
              </p>
            ) : (
              list.map((c) => (
                <div
                  key={c.id}
                  className={`history-item ${c.id === r.conversationId ? "current" : ""}`}
                >
                  {renameId === c.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        r.guard(async () => {
                          await r.patchConversation(c.id, { title: name });
                          setRenameId("");
                        });
                      }}
                    >
                      <input
                        aria-label="新的会话名称"
                        autoFocus
                        maxLength={100}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <button type="submit" disabled={!name.trim()}>
                        保存
                      </button>
                      <button type="button" onClick={() => setRenameId("")}>
                        取消
                      </button>
                    </form>
                  ) : (
                    <button
                      className="history-select"
                      onClick={() => {
                        r.setConversationId(c.id);
                        setHistory(false);
                      }}
                    >
                      <span>
                        {c.pinned && <Icon name="pin" size={13} />}
                        {c.title}
                      </span>
                      <small>
                        {c.matchText ||
                          `${c.parentConversationId ? "分支 · " : ""}${new Date(c.updatedAt || c.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      </small>
                    </button>
                  )}
                  <div className="history-actions">
                    {c.archived && (
                      <button
                        aria-label={`删除归档会话 ${c.title}`}
                        title="删除归档会话"
                        onClick={() =>
                          r.guard(async () => {
                            const impact = await api<{
                              turns: number;
                              branches: number;
                            }>(`/conversations/${c.id}/impact`);
                            if (
                              confirm(
                                `删除“${c.title}”及 ${impact.turns} 条问答？其他分支和已打开解释窗将保留。`,
                              )
                            )
                              await r.deleteConversation(c.id);
                          })
                        }
                      >
                        删除
                      </button>
                    )}
                    <button
                      title="重命名"
                      aria-label={`重命名 ${c.title}`}
                      onClick={() => startRename(c)}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      title={c.pinned ? "取消置顶" : "置顶"}
                      aria-label={c.pinned ? "取消置顶" : "置顶"}
                      onClick={() =>
                        r.guard(() =>
                          r.patchConversation(c.id, { pinned: !c.pinned }),
                        )
                      }
                    >
                      <Icon name="pin" size={14} />
                    </button>
                    <button
                      title={c.archived ? "恢复会话" : "归档"}
                      aria-label={c.archived ? "恢复会话" : "归档"}
                      disabled={c.id === r.conversationId && !!r.active}
                      onClick={() =>
                        r.guard(() =>
                          r.patchConversation(c.id, { archived: !c.archived }),
                        )
                      }
                    >
                      <Icon
                        name={c.archived ? "restore" : "archive"}
                        size={14}
                      />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="history-footnote">
            {r.course?.name || r.doc?.name}
          </div>
        </div>
      )}
    </>
  );
}
