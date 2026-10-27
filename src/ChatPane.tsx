import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Reader } from "./useReader.ts";
import { ChatHeader } from "./chat/ChatHeader.tsx";
import { ChatMessage } from "./chat/ChatMessage.tsx";
import { ChatComposer } from "./chat/ChatComposer.tsx";
import { Icon } from "./controls.tsx";
import "./chat/chat.css";
import type { Rect } from "../shared/types.ts";

const positions = new Map<string, { top: number; follow: boolean }>();
export function ChatPane({ r, onClose, expanded = false, onExpand }: { r: Reader; onClose: () => void; expanded?: boolean; onExpand?: (value: boolean) => void }) {
  const [history, setHistory] = useState(false),
    [atBottom, setAtBottom] = useState(true);
  const scroll = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    loadedConversation = useRef(""),
    previousSending = useRef(false),
    anchor = useRef<{ id?: string; offset: number; bottom: boolean } | null>(
      null,
    );
  const latest = () => {
    follow.current = true;
    setAtBottom(true);
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  };
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || !r.turns.length) return;
    if (loadedConversation.current !== r.conversationId) {
      loadedConversation.current = r.conversationId;
      const saved = positions.get(r.conversationId);
      follow.current = saved?.follow ?? true;
      el.scrollTop = follow.current ? el.scrollHeight : saved?.top || 0;
      setAtBottom(follow.current);
    } else if (follow.current) el.scrollTop = el.scrollHeight;
  }, [r.turns, r.conversationId]);
  useEffect(() => {
    if (r.sending && !previousSending.current) latest();
    previousSending.current = r.sending;
  }, [r.sending]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (follow.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const expand = (next: boolean) => {
    const host = scroll.current;
    const first =
      host &&
      [...host.querySelectorAll<HTMLElement>(".chat-turn")].find(
        (el) =>
          el.getBoundingClientRect().bottom > host.getBoundingClientRect().top,
      );
    anchor.current = {
      id: first?.id,
      offset:
        first && host
          ? first.getBoundingClientRect().top - host.getBoundingClientRect().top
          : 0,
      bottom: follow.current,
    };
    onExpand?.(next);
  };
  useLayoutEffect(() => {
    const saved = anchor.current,
      host = scroll.current;
    if (!saved || !host) return;
    if (saved.bottom) latest();
    else if (saved.id) {
      const item = document.getElementById(saved.id);
      if (item)
        host.scrollTop +=
          item.getBoundingClientRect().top -
          host.getBoundingClientRect().top -
          saved.offset;
    }
    anchor.current = null;
  }, [expanded]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        e.isComposing ||
        e.defaultPrevented ||
        !(e.target as HTMLElement)?.closest(".chat-v2") ||
        document.querySelector(
          '[aria-modal="true"],.pointer-menu,.citation-preview',
        ) ||
        (e.target as HTMLElement)?.closest(".chat-popup,details[open]")
      )
        return;
      if (history || expanded) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (history) setHistory(false);
        else expand(false);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [history, expanded]);
  useEffect(() => {
    setHistory(false);
  }, [r.docId]);
  useEffect(() => {
    if (!expanded) return;
    (
      document.querySelector(".chat-expanded .chat-title") as HTMLElement
    )?.focus();
  }, [expanded]);
  const navigate = (page: number, documentId?: string, rect?: Rect) => {
    if (expanded) expand(false);
    r.navigateSource(page, documentId, rect);
    if (window.innerWidth < 900) onClose();
    requestAnimationFrame(() =>
      (document.querySelector(".reader-surface") as HTMLElement)?.focus(),
    );
  };
  return (
    <section
      className={`chat chat-v2 ${expanded ? "chat-expanded" : ""}`}
      aria-label="问答窗格"
    >
      <ChatHeader
        r={r}
        expanded={expanded}
        onExpand={() => expand(!expanded)}
        onClose={onClose}
        history={history}
        setHistory={setHistory}
      />
      {r.connectionLost && (
        <div className="chat-notice" role="status">
          连接已断开，正在重连。已发送的问题不会重复发送。
        </div>
      )}
      {r.conversation?.parentConversationId && (
        <div className="branch-banner">
          <Icon name="branch" size={14} /> 来自另一段讨论{" "}
          <button
            onClick={() =>
              r.setConversationId(r.conversation!.parentConversationId!)
            }
          >
            返回原会话
          </button>
        </div>
      )}
      <div className="chat-flow">
        <div
          className="chat-scroll"
          ref={scroll}
          tabIndex={0}
          aria-label="对话记录"
          onScroll={(e) => {
            const el = e.currentTarget,
              bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            follow.current = bottom;
            setAtBottom(bottom);
            positions.set(r.conversationId, {
              top: el.scrollTop,
              follow: bottom,
            });
          }}
        >
          <div className="chat-content" ref={content}>
            {!r.conversationId ? (
              <div className="chat-empty-v2">正在打开会话…</div>
            ) : !r.turns.length ? (
              <div className="chat-empty-v2">
                <div className="empty-chat-heading">
                  <Icon name="chat" size={24} />
                  <h2>从这一页开始</h2>
                </div>
                <p>选一个方向，或直接输入你的问题。</p>
                <div className="chat-starters">
                  {[
                    {
                      title: "概括本页",
                      icon: "list",
                      detail: "抓住重点与结论",
                      prompt: "请概括这一页的重点。",
                    },
                    {
                      title: "解释概念",
                      icon: "text",
                      detail: "把术语讲清楚",
                      prompt: "请解释这一页的核心概念。",
                    },
                    {
                      title: "逐步解答",
                      icon: "steps",
                      detail: "拆解公式与步骤",
                      prompt: "请逐步讲解这一页的题目、公式或推导过程。",
                    },
                    {
                      title: "联系前文",
                      icon: "branch",
                      detail: "串联前后的知识",
                      prompt: "这一页与前面的内容有什么联系？",
                    },
                  ].map(({ title, icon, detail, prompt }, i) => (
                    <button
                      key={title}
                      aria-label={title}
                      className={"starter-card starter-" + i}
                      onClick={() => {
                        r.setQuestion(prompt);
                        r.input.current?.focus();
                      }}
                    >
                      <span className="starter-icon">
                        <Icon name={icon} size={23} />
                      </span>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              r.turns.map((t) => (
                <ChatMessage key={t.id} r={r} turn={t} navigate={navigate} />
              ))
            )}
          </div>
        </div>
        {!atBottom && r.turns.length > 0 && (
          <button className="jump-latest" onClick={latest}>
            <Icon name="down" size={15} />
            回到最新
          </button>
        )}
      </div>
      <ChatComposer r={r} />
    </section>
  );
}
