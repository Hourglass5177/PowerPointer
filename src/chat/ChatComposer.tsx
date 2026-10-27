import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Reader } from "../useReader.ts";
import { api, renderUrl } from "../api.ts";
import { Icon } from "../controls.tsx";
import type { AnswerLength, Scope } from "../../shared/types.ts";
import { ModelList, AssistantSelect, selectedModel, ProfileButtons } from "../AIControls.tsx";

const scopeInfo = {
  page: ["当前页", "整页图像、选区及附加页面"],
  nearby: ["附近页", "当前页及前后各两页的文字"],
  full: ["整份课件检索", "按问题检索相关页面，可用工具继续查阅"],
};
const effortNames: Record<string, string> = {
  none: "不额外思考",
  minimal: "极轻量",
  low: "轻量",
  medium: "标准",
  high: "深入",
  xhigh: "更深入",
  max: "最高",
  ultra: "极深",
};
function Popup({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    const buttons = () => [
      ...(el?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input,select,[tabindex="0"]',
      ) || []),
    ];
    buttons()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const list = buttons(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const outside = (e: PointerEvent) => {
      if (
        !el?.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest("[data-chat-menu-trigger]")
      )
        onClose();
    };
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", outside);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="chat-popup"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="chat-popup-heading">
        <strong>{title}</strong>
        <button aria-label={`关闭${title}`} onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {children}
    </div>
  );
}
export function ChatComposer({ r }: { r: Reader }) {
  const [menu, setMenu] = useState(""),
    [composing, setComposing] = useState(false);
  const compositionEnded = useRef(0);
  const data = r.chatDraft,
    draft = r.draft;
  const models = r.models;
  const modelValue = { ...data, connectionId: data.connectionId || r.conversation?.connectionId || r.ai.config?.preferences.defaultConnectionId, model: data.model || (!data.connectionId || data.connectionId === r.conversation?.connectionId ? r.conversation?.model : undefined) };
  const selected = selectedModel(models, modelValue, r.ai.config?.preferences.defaultConnectionId);
  const effort = data.reasoningEffort || selected?.defaultReasoningEffort;
  const openMenu = (name: string) =>
    setMenu((old) => (old === name ? "" : name));
  useEffect(() => {
    setMenu("");
  }, [r.conversationId, r.workspaceView]);
  useLayoutEffect(() => {
    const el = r.input.current;
    if (el) {
      el.style.height = "0px";
      el.style.height = Math.max(60, Math.min(208, el.scrollHeight)) + "px";
    }
  }, [r.question, r.conversationId]);
  if (r.conversation?.archived)
    return (
      <div className="archived-composer">
        <Icon name="archive" size={18} />
        <span>此会话已归档</span>
        <button
          onClick={() =>
            r.guard(() =>
              r.patchConversation(r.conversationId, { archived: false }),
            )
          }
        >
          恢复并继续
        </button>
      </div>
    );
  return (
    <div className="composer-v2">
      {!!data.selections?.length && (
        <div className="reference-cards">
          {data.selections.map((ref) => (
            <div className="reference-card" key={ref.id}>
              <button
                title="预览引用"
                onClick={() =>
                  r.setImage(
                    ref.image
                      ? `/api/attachments/${ref.image}`
                      : renderUrl(
                          ref.documentId,
                          ref.page,
                          ref.rotation,
                          ref.rect,
                        ),
                  )
                }
              >
                <img
                  alt="已冻结的引用选区"
                  src={
                    ref.image
                      ? `/api/attachments/${ref.image}`
                      : renderUrl(
                          ref.documentId,
                          ref.page,
                          ref.rotation,
                          ref.rect,
                          true,
                        )
                  }
                />
              </button>
              <button
                className="reference-label"
                onClick={() =>
                  r.navigateSource(ref.page, ref.documentId, ref.rect)
                }
              >
                <span>{ref.documentName}</span>
                <small>第 {ref.page} 页 · 返回原位置</small>
              </button>
              <button
                aria-label="移除引用"
                onClick={() => r.guard(() => r.removeReference(ref.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {data.editTurnId && (
        <div className="edit-banner">
          <Icon name="branch" size={14} />
          <span>修改后将创建分支</span>
          <button onClick={() => r.clearContext()}>取消修改</button>
        </div>
      )}
      {data.replyTurnId && !data.editTurnId && (
        <div className="reply-banner">
          <Icon name="chat" size={14} />
          <span>
            追问：
            {r.turns.find((t) => t.id === data.replyTurnId)?.question ||
              "原回答"}
          </span>
          <button aria-label="取消追问" onClick={r.clearContext}>
            ×
          </button>
        </div>
      )}
      {draft && (
        <div className="draft-context">
          <button
            className="draft-page"
            title={r.doc?.name}
            onClick={() => r.setPreview(!r.preview)}
          >
            <Icon name={data.pinned ? "pin" : "file"} size={14} />
            {data.pinned ? "已锁定" : "当前页"}
            <strong>第 {draft.page} 页</strong>
            <Icon name="down" size={12} />
          </button>
          {data.pinned && !data.editTurnId && (
            <button className="unpin-context" onClick={r.followCurrentPage}>
              跟随当前页
            </button>
          )}
          {(draft.rect || draft.selectedText) && (
            <button
              className="draft-selection"
              title={draft.selectedText || "已框选页面区域"}
              disabled={!!data.editTurnId}
              onClick={() =>
                r.patchDraft({ selectedText: "", rect: undefined })
              }
            >
              {draft.rect ? "框选区域" : `${draft.selectedText.length} 字选区`}{" "}
              ×
            </button>
          )}
          {draft.extraPages.map((p) => (
            <button
              className="draft-selection"
              key={p}
              disabled={!!data.editTurnId}
              onClick={() => r.setExtraPages((ps) => ps.filter((n) => n !== p))}
            >
              附图 {p} ×
            </button>
          ))}
        </div>
      )}
      {r.preview && draft && (
        <div className="draft-preview">
          <button
            onClick={() =>
              r.setImage(
                renderUrl(draft.documentId, draft.page, draft.rotation),
              )
            }
          >
            <img
              src={renderUrl(
                draft.documentId,
                draft.page,
                draft.rotation,
                undefined,
                true,
              )}
              alt="本次整页预览"
            />
          </button>
          {draft.rect && (
            <button
              onClick={() =>
                r.setImage(
                  renderUrl(
                    draft.documentId,
                    draft.page,
                    draft.rotation,
                    draft.rect,
                  ),
                )
              }
            >
              <img
                src={renderUrl(
                  draft.documentId,
                  draft.page,
                  draft.rotation,
                  draft.rect,
                  true,
                )}
                alt="框选裁图预览"
              />
            </button>
          )}
          {draft.selectedText && <blockquote>{draft.selectedText}</blockquote>}
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={r.input}
          aria-label="向课件提问"
          placeholder={r.active ? "可以先写下一个问题…" : "针对课件提问…"}
          value={r.question}
          maxLength={6000}
          onChange={(e) => r.setQuestion(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => {
            setComposing(false);
            compositionEnded.current = Date.now();
          }}
          onKeyDown={(e) => {
            if (
              e.key !== "Enter" ||
              e.shiftKey ||
              composing ||
              e.nativeEvent.isComposing ||
              e.keyCode === 229 ||
              Date.now() - compositionEnded.current < 100 ||
              e.repeat
            )
              return;
            e.preventDefault();
            if (!r.active && !r.sending) void r.send();
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              title="提问设置"
              aria-label="提问设置"
              data-chat-menu-trigger
              aria-expanded={menu === "settings"}
              onClick={() => openMenu("settings")}
            >
              <Icon name="settings" size={16} />
              <span>设置</span>
            </button>
          </div>
          {r.active ? (
            <button
              className="chat-stop"
              title="停止生成"
              aria-label="停止生成"
              onClick={() =>
                r.guard(() =>
                  api(`/turns/${r.active!.id}/stop`, { method: "POST" }),
                )
              }
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              className="chat-send"
              title="发送（Enter）"
              aria-label="发送问题"
              disabled={
                r.sending ||
                !r.question.trim() ||
                !r.conversationId ||
                r.connectionLost
              }
              onClick={() => void r.send()}
            >
              <Icon name="send" size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-bottom">
        <AssistantSelect ai={r.ai} value={data} onChange={(v, scope) => r.patchDraft({ ...v, ...(scope ? { scope } : {}) })} />
        <button
          className="model-trigger"
          aria-label="选择模型"
          data-chat-menu-trigger
          aria-expanded={menu === "model"}
          onClick={() => openMenu("model")}
          title={selected?.model || "选择模型"}
        >
          <span>{selected?.displayName || "选择模型"}</span>
          <Icon name="down" size={11} />
        </button>
        <select className="composer-scope" aria-label="资料范围" value={data.scope} onChange={e => r.patchDraft({ scope: e.target.value as Scope })}>{(Object.keys(scopeInfo) as Scope[]).map(scope => <option key={scope} value={scope}>{scope === "full" && r.course ? "课程来源" : scopeInfo[scope][0]}</option>)}</select>
      </div>
      {r.draftError && (
        <p className="composer-notice" role="status">
          {r.draftError}
        </p>
      )}
      {menu && (
        <Popup
          key={menu}
          title={menu === "model" ? "选择模型" : "提问设置"}
          onClose={() => setMenu("")}
        >
          {menu === "settings" && (
            <div className="composer-settings">
              <ProfileButtons ai={r.ai} onChange={v => r.patchDraft(v)} />
              <label>
                范围
                <select
                  value={data.scope}
                  onChange={(e) =>
                    r.patchDraft({ scope: e.target.value as Scope })
                  }
                >
                  {(Object.keys(scopeInfo) as Scope[]).map((scope) => (
                    <option key={scope} value={scope}>
                      {scope === "full" && r.course
                        ? "课程来源"
                        : scopeInfo[scope][0]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                思考强度
                <select
                  value={effort || ""}
                  onChange={(e) =>
                    r.patchDraft({ reasoningEffort: e.target.value })
                  }
                >
                  {selected?.supportedReasoningEfforts.map((e) => (
                    <option key={e.reasoningEffort} value={e.reasoningEffort}>
                      {effortNames[e.reasoningEffort] || e.reasoningEffort}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                回答长度
                <select
                  value={data.answerLength}
                  onChange={(e) =>
                    r.patchDraft({
                      answerLength: e.target.value as AnswerLength,
                    })
                  }
                >
                  <option value="short">简短</option>
                  <option value="standard">标准</option>
                  <option value="detailed">详细</option>
                </select>
              </label>
              <label>
                <input type="checkbox" checked={data.textOnly || false} onChange={e => r.patchDraft({ textOnly: e.target.checked })} />
                仅文本（不发送页面图像）
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={data.agentTools ?? true}
                  onChange={(e) =>
                    r.patchDraft({ agentTools: e.target.checked })
                  }
                />
                课件工具
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={data.webSearch ?? false}
                  onChange={(e) =>
                    r.patchDraft({ webSearch: e.target.checked })
                  }
                />
                联网
              </label>
            </div>
          )}
          {menu === "model" && (
            <ModelList models={models} value={modelValue} ai={r.ai} onChange={v => r.patchDraft(v)} onDone={() => setMenu("")} />
          )}
        </Popup>
      )}
    </div>
  );
}
