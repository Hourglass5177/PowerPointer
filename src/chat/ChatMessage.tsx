import { useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Reader } from "../useReader.ts";
import { stateLabels, type Turn, type Rect } from "../../shared/types.ts";
import { requestPointer, selectedOrBlock } from "../selection.ts";
import { api } from "../api.ts";
import { citedSources, portableAnswer } from "../../shared/chat.ts";
import { answerMarkdown } from "../../shared/markdown.ts";
import { Icon } from "../controls.tsx";
import { Citation } from "./Citation.tsx";
import { requestSaveAnswer } from "../useNotes.ts";
import { requestResearch } from "../research.ts";
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null),
    [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="code-block">
      <button
        aria-label="复制代码"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ref.current?.textContent || "");
            setCopied(true);
            setError(false);
          } catch {
            setCopied(false);
            setError(true);
          }
        }}
      >
        {error ? "请选中后 Ctrl+C" : copied ? "已复制" : "复制代码"}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
function safeLink(url: string) {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? url : "";
  } catch {
    return "";
  }
}
export function ChatMessage({
  r,
  turn: t,
  navigate,
}: {
  r: Reader;
  turn: Turn;
  navigate: (n: number, documentId?: string, rect?: Rect) => void;
}) {
  const [copied, setCopied] = useState(""),
    [followMenu, setFollowMenu] = useState(false);
  const cited = citedSources(t.answer, r.sources),
    busy = !!r.active || r.sending;
  const copy = async (text: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      r.setError("复制失败，请选中文字后使用 Ctrl+C。");
    }
  };
  return (
    <article
      className="chat-turn"
      id={`message-${t.id}`}
      data-testid={`turn-${t.id}`}
    >
      {t.switchedModel && <div className="ai-switch-marker">已切换至 {t.connectionName || t.connectionId} · {t.model}</div>}
      <div className="user-message">
        <div className="user-message-bubble">{t.question}</div>
        <div className="user-message-tools">
          <button
            onClick={() =>
              navigate(t.snapshot.page, t.snapshot.documentId, t.snapshot.rect)
            }
          >
            第 {t.snapshot.page} 页
          </button>
          <button
            title="复制问题"
            aria-label="复制问题"
            onClick={() => void copy(t.question, "question")}
          >
            <Icon name={copied === "question" ? "check" : "copy"} size={14} />
          </button>
          <button
            title="修改问题并创建分支"
            aria-label="修改问题"
            disabled={busy}
            onClick={() => r.edit(t)}
          >
            <Icon name="edit" size={14} />
          </button>
          <details className="sent-materials">
            <summary>已发送材料</summary>
            <div className="sent-materials-content">
              <div className="attachment-thumbs">
                {t.snapshot.images.map((name, i) => (
                  <button
                    key={name}
                    title={
                      i === 0
                        ? "已发送整页"
                        : t.snapshot.rect && i === 1
                          ? "已发送裁图"
                          : "已发送附图"
                    }
                    onClick={() => r.setImage(`/api/attachments/${name}`)}
                  >
                    <img
                      src={`/api/attachments/${name}`}
                      alt={
                        i === 0
                          ? `已发送第 ${t.snapshot.page} 页整页`
                          : "已发送附图"
                      }
                    />
                  </button>
                ))}
              </div>
              {t.snapshot.selectedText && (
                <blockquote>{t.snapshot.selectedText}</blockquote>
              )}
              <p>
                参考范围：
                {
                  { page: "当前页", nearby: "附近页", full: "整份课件检索" }[
                    t.snapshot.scope
                  ]
                }
              </p>
              <p>
                提供的页面：
                {t.snapshot.sources.map((s) => s.page).join("、") || "准备中"}
              </p>
            </div>
          </details>
        </div>
      </div>
      <div className="assistant-message">
        {t.state === "completed" && <button className="ai-review-answer" onClick={() => requestResearch({ mode: "review", reviewTurnId: t.id, selection: { id: crypto.randomUUID(), kind: "answer", documentId: t.snapshot.documentId, documentName: t.snapshot.sources[0]?.documentName, page: t.snapshot.page, rotation: t.snapshot.rotation, text: t.question, turnId: t.id }, goal: `核查这条回答的依据、推导和遗漏，区分一致点、分歧与待确认内容：${t.question}` })}>请另一模型核查</button>}
        {t.snapshot.aiContext && <details className="ai-context-snapshot"><summary>本轮上下文 · {t.snapshot.aiContext.documentIds.length} 份资料 · {t.snapshot.aiContext.notes.length} 条笔记 · {t.snapshot.aiContext.history.length} 轮讨论</summary><p>{t.connectionName || t.connectionId || "Codex"} · {t.model} · {t.snapshot.textOnly ? "仅文本" : "含页面图像"}</p><p>助手：{t.snapshot.assistantSnapshot?.name || "课程讲解"}</p><pre>{t.snapshot.aiContext.memories.map(m => `${m.title}：${m.text}`).join("\n")}</pre>{t.snapshot.aiContext.history.length > 0 && <details><summary>发送的历史摘要（保留原记录）</summary><pre>{t.snapshot.aiContext.history.map((h, i, all) => `${h.question}\n${h.answer.slice(0, i < all.length - 4 ? 1200 : 5000)}`).join("\n\n")}</pre></details>}<details><summary>使用的笔记</summary><pre>{t.snapshot.aiContext.notes.slice(-12).map(n => `${n.title}\n${n.text.slice(0, 2000)}`).join("\n\n") || "无"}</pre></details></details>}
        {t.state !== "completed" && (
          <div className={`message-status ${t.state}`} role="status">
            {["preparing", "generating"].includes(t.state) && (
              <span className="status-dot" />
            )}
            {stateLabels[t.state]}
          </div>
        )}
        {!!t.tools?.length && (
          <details
            className="tool-activity"
            open={t.state === "generating" ? true : undefined}
          >
            <summary>
              <Icon name="steps" size={14} />
              {t.tools.some((x) => x.state === "running")
                ? "正在查阅资料"
                : `查阅过程 · ${t.tools.length} 项操作`}
            </summary>
            <ol>
              {t.tools.map((tool) => (
                <li key={tool.id}>
                  <Icon
                    name={tool.kind === "web" ? "globe" : "file"}
                    size={14}
                  />
                  <div>
                    <strong>{tool.title}</strong>
                    <p>{tool.detail}</p>
                    {!!tool.links?.length && (
                      <div className="tool-links">
                        {tool.links.map(
                          (link) =>
                            safeLink(link.url) && (
                              <a
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {link.title} ↗
                              </a>
                            ),
                        )}
                      </div>
                    )}
                  </div>
                  <span>
                    {tool.state === "running"
                      ? "进行中"
                      : tool.state === "failed"
                        ? "未完成"
                        : "完成"}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
        <div
          className="answer answer-v2"
          onContextMenu={(e) => {
            const text = selectedOrBlock(e, e.currentTarget);
            if (!text) return;
            e.preventDefault();
            requestPointer({
              selection: {
                id: crypto.randomUUID(),
                kind: "answer",
                documentId: t.snapshot.documentId,
                documentName: r.documents.find(
                  (d) => d.id === t.snapshot.documentId,
                )?.name,
                page: t.snapshot.page,
                rotation: t.snapshot.rotation,
                text,
                turnId: t.id,
              },
              position: { x: e.clientX, y: e.clientY },
            });
          }}
        >
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            urlTransform={(url) =>
              url.startsWith("source:") ? url : safeLink(url)
            }
            components={{
              a: ({ href, children }) => {
                const source = href?.startsWith("source:")
                  ? r.sources.get(href.slice(7))
                  : undefined;
                return source ? (
                  <Citation source={source} navigate={navigate}>
                    {children}
                  </Citation>
                ) : href && safeLink(href) ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                    <span className="external-mark">↗</span>
                  </a>
                ) : (
                  <span>{children}</span>
                );
              },
              img: () => null,
              pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
            }}
          >
            {answerMarkdown(t.answer)}
          </Markdown>
        </div>
        {t.error && (
          <div className="message-error" role="alert">
            {t.error}
          </div>
        )}
        {cited.length > 0 && (
          <div className="answer-sources">
            <span>来源</span>
            {cited.map((s) => (
              <Citation key={s.id} source={s} navigate={navigate} />
            ))}
          </div>
        )}
        {(t.answer || ["failed", "stopped", "unknown"].includes(t.state)) && (
          <div className="message-actions">
            {t.answer && (
              <button
                title="复制回答"
                aria-label="复制回答"
                onClick={() =>
                  void copy(
                    portableAnswer(t.answer, r.sources, r.doc?.name || "课件"),
                    "answer",
                  )
                }
              >
                <Icon name={copied === "answer" ? "check" : "copy"} size={16} />
                <span>{copied === "answer" ? "已复制" : "复制"}</span>
              </button>
            )}
            {t.answer && (
              <button
                onClick={() => {
                  r.followup(t);
                  setFollowMenu(!followMenu);
                }}
              >
                <Icon name="chat" size={16} />
                追问
              </button>
            )}
            {t.state === "completed" && <button onClick={() => requestSaveAnswer(t.id, "turn")}><Icon name="edit" size={16} />存为笔记</button>}
            <details className="popover message-more">
              <summary aria-label="更多回答操作">
                <Icon name="more" size={16} />
              </summary>
              <div className="popover-panel">
                {" "}
                {t.state === "completed" && (
                  <button
                    disabled={busy}
                    title="在新分支中重新回答"
                    onClick={() => void r.retry(t, "branch")}
                  >
                    <Icon name="retry" size={16} />
                    重新回答
                  </button>
                )}
                {["failed", "stopped", "unknown"].includes(t.state) && (
                  <button
                    disabled={busy}
                    onClick={() => void r.retry(t, "retry")}
                  >
                    <Icon name="retry" size={16} />
                    {t.state === "unknown" ? "核对结果并重试" : "重试"}
                  </button>
                )}
                {t.model && (
                  <details className="response-info">
                    <summary aria-label="本次模型信息">
                      <Icon name="info" size={14} />
                    </summary>
                    <p>
                      {t.model} · {t.reasoningEffort || "默认"}
                      {t.tokenUsage
                        ? ` · ${t.tokenUsage.total.toLocaleString()} tokens`
                        : ""}
                    </p>
                  </details>
                )}
              </div>
            </details>{" "}
          </div>
        )}
        {t.state === "completed" && followMenu && (
          <div className="followup-choices">
            {["再简单些", "分步解释", "举个例子"].map((label, i) => (
              <button
                key={label}
                onClick={() =>
                  r.followup(
                    t,
                    [
                      "请用更简单的话解释这个回答。",
                      "请分步骤解释这个回答中的推导或结论。",
                      "请用一个具体例子说明这个回答。",
                    ][i],
                  )
                }
              >
                {label}
                <span>↗</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
