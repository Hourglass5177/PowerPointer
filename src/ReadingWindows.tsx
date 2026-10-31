import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Reader } from "./useReader.ts";
import type { ReadingWindows as WindowsController } from "./useReadingWindows.ts";
import {
  activeStates,
  stateLabels,
  type ReadingSession,
  type Turn,
} from "../shared/types.ts";
import { sourceMap, portableAnswer } from "../shared/chat.ts";
import { defaultEffort, modelEfforts } from "../shared/ai.ts";
import { RichAnswer } from "./RichAnswer.tsx";
import { requestPointer, selectedOrBlock } from "./selection.ts";
import { api, renderUrl } from "./api.ts";
import { Icon } from "./controls.tsx";
import { requestSaveAnswer } from "./useNotes.ts";
import { ModelSelect, AssistantSelect, selectedModel } from "./AIControls.tsx";
function Window({
  session: s,
  turns,
  controller: w,
  r,
  front,
  narrow,
}: {
  session: ReadingSession;
  turns: Turn[];
  controller: WindowsController;
  r: Reader;
  front: boolean;
  narrow: boolean;
}) {
  const [layout, setLayout] = useState(s.layout),
    [draft, setDraft] = useState(s.draft),
    [options, setOptions] = useState(false),
    [sending, setSending] = useState(false),
    [notice, setNotice] = useState("");
  const drag = useRef<{
      x: number;
      y: number;
      left: number;
      top: number;
      width: number;
      height: number;
      resize: boolean;
    } | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    latestDraft = useRef(draft),
    latestLayout = useRef(layout),
    alive = useRef(true),
    busy = useRef(false);
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    composition = useRef(false),
    compositionEnd = useRef(0);
  const serverDraft = useRef(s.draft);
  useEffect(() => {
    const previous = serverDraft.current;
    setDraft((old) => (old === previous ? s.draft : old));
    serverDraft.current = s.draft;
  }, [s.draft]);
  latestDraft.current = draft;
  latestLayout.current = layout;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!drag.current) setLayout(s.layout);
  }, [
    s.layout.x,
    s.layout.y,
    s.layout.width,
    s.layout.height,
    s.layout.minimized,
  ]);
  const width = narrow
    ? window.innerWidth - 24
    : Math.max(280, Math.min(layout.width, window.innerWidth - 24));
  const height = Math.max(
    180,
    Math.min(layout.height, window.innerHeight - 120),
  );
  const left = narrow
    ? 12
    : Math.max(
        8,
        Math.min(
          window.innerWidth - width - 8,
          layout.x * (window.innerWidth - width),
        ),
      );
  const top = narrow
    ? 140
    : Math.max(
        64,
        Math.min(
          window.innerHeight - (layout.minimized ? 42 : height) - 16,
          layout.y * (window.innerHeight - height),
        ),
      );
  const saveLayout = (value: typeof layout) => {
    setLayout(value);
    void w
      .patch(s.id, { layout: value })
      .catch((e) => alive.current && setNotice(e.message));
  };
  const begin = (e: React.PointerEvent, resize = false) => {
    if (
      narrow ||
      (!resize && (e.target as HTMLElement).closest("button,select,input"))
    )
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    w.setFocused(s.id);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left,
      top,
      width,
      height,
      resize,
    };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.resize)
      setLayout((v) => ({
        ...v,
        width: Math.max(
          280,
          Math.min(window.innerWidth - 24, d.width + e.clientX - d.x),
        ),
        height: Math.max(
          180,
          Math.min(window.innerHeight - 120, d.height + e.clientY - d.y),
        ),
      }));
    else
      setLayout((v) => ({
        ...v,
        x: Math.max(
          0,
          Math.min(
            1,
            (d.left + e.clientX - d.x) / Math.max(1, window.innerWidth - width),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            1,
            (d.top + e.clientY - d.y) /
              Math.max(1, window.innerHeight - height),
          ),
        ),
      }));
  };
  const end = () => {
    if (drag.current) {
      drag.current = null;
      saveLayout(latestLayout.current);
    }
  };
  const active = turns.find((t) => activeStates.includes(t.state)),
    sources = sourceMap(turns);
  const model = selectedModel(r.models, s.settings, r.ai.config?.preferences.defaultConnectionId);
  useLayoutEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [turns]);
  const saveDraft = (value: string) => {
    setDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        void w
          .patch(s.id, { draft: value })
          .catch((e) => alive.current && setNotice(e.message)),
      220,
    );
  };
  const send = async (text = draft) => {
    if (!text.trim() || active || busy.current) return;
    if (!r.requireAI()) return;
    busy.current = true;
    setSending(true);
    setNotice("");
    clearTimeout(timer.current);
    const key = `pointer-send-${s.id}`;
    let request: { question: string; id: string } | undefined;
    try {
      request = JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {}
    if (request?.question !== text.trim())
      request = { question: text.trim(), id: crypto.randomUUID() };
    sessionStorage.setItem(key, JSON.stringify(request));
    try {
      await w.patch(s.id, { draft: text });
      await w.ask(s.id, request.question, request.id);
      sessionStorage.removeItem(key);
      if (latestDraft.current === text) {
        setDraft("");
        await w.patch(s.id, { draft: "" });
      }
      follow.current = true;
    } catch (e: any) {
      if (e.status) sessionStorage.removeItem(key);
      if (alive.current) setNotice(e.message);
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  };
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={`解释：${s.title}`}
      className={`reading-window ${front ? "focused" : ""} ${layout.minimized ? "minimized" : ""}`}
      onKeyDown={(e) => {
        if (
          e.key !== "Escape" ||
          e.nativeEvent.isComposing ||
          e.nativeEvent.keyCode === 229 ||
          e.defaultPrevented
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        if (options) setOptions(false);
        else r.guard(() => w.close(s.id));
      }}
      style={{
        left,
        top,
        width,
        height: layout.minimized ? 42 : height,
        zIndex: front ? 610 : 600,
        display: narrow && !front ? "none" : undefined,
      }}
      onPointerDownCapture={() => {
        if (!front) w.setFocused(s.id);
      }}
    >
      <header
        className="reading-titlebar"
        tabIndex={0}
        aria-label="拖动解释窗"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement) !== e.currentTarget) return;
          if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            saveLayout({
              ...layout,
              x: Math.max(
                0,
                Math.min(
                  1,
                  layout.x +
                    (e.key === "ArrowRight"
                      ? 0.025
                      : e.key === "ArrowLeft"
                        ? -0.025
                        : 0),
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  1,
                  layout.y +
                    (e.key === "ArrowDown"
                      ? 0.025
                      : e.key === "ArrowUp"
                        ? -0.025
                        : 0),
                ),
              ),
            });
          }
        }}
      >
        <Icon name="text" size={16} />
        <strong title={s.title}>{s.title}</strong>
        <button
          title="解释窗设置"
          aria-label="解释窗设置"
          onClick={() => setOptions((v) => !v)}
        >
          <Icon name="settings" size={14} />
        </button>
        <button
          title={layout.minimized ? "还原解释窗" : "最小化解释窗"}
          aria-label={layout.minimized ? "还原解释窗" : "最小化解释窗"}
          onClick={() =>
            saveLayout({ ...layout, minimized: !layout.minimized })
          }
        >
          {layout.minimized ? "□" : "−"}
        </button>
        <button
          title="关闭并清理此窗（保留子窗）"
          aria-label="关闭解释窗"
          onClick={() => r.guard(() => w.close(s.id))}
        >
          ×
        </button>
      </header>
      {!layout.minimized && (
        <>
          <div className="reading-breadcrumb">
            <button
              onClick={() =>
                r.navigateSource(
                  s.selection.page,
                  s.selection.documentId,
                  s.selection.rect,
                  s.selection.rects,
                )
              }
              title={s.selection.documentName}
            >
              {s.selection.documentName} · 第 {s.selection.page} 页
            </button>
            {s.parentId && (
              <>
                <span> › </span>
                <button
                  disabled={!w.sessions.some((p) => p.id === s.parentId)}
                  onClick={() => { w.setFocused(s.parentId!); const parent = w.sessions.find(p => p.id === s.parentId); if (parent?.layout.minimized) r.guard(() => w.patch(parent.id, { layout: { ...parent.layout, minimized: false } })); }}
                >
                  {s.parentTitle || "父窗"}
                  {!w.sessions.some((p) => p.id === s.parentId)
                    ? "（已关闭）"
                    : ""}
                </button>
              </>
            )}
          </div>
          {options && (
            <div className="reading-options">
              {" "}
              <div className="reading-context-label" title={s.contextTitle}>
                {s.contextTitle
                  ? `${s.contextTitle} · ${s.sourceCount} 份来源 · `
                  : ""}
                背景已冻结 ·{" "}
                {model?.displayName || s.settings.model || "默认模型"}
                {s.settings.webSearch ? " · 联网" : ""}
              </div>
              <label>助手<AssistantSelect ai={r.ai} value={s.settings} onChange={value => r.guard(() => w.patch(s.id, { settings: { ...s.settings, ...value } }))} /></label><label>模型<ModelSelect models={r.models} value={s.settings} ai={r.ai} onChange={value => r.guard(() => w.patch(s.id, { settings: { ...s.settings, ...value } }))} /></label><label><input type="checkbox" checked={!!s.settings.textOnly} onChange={e => r.guard(() => w.patch(s.id, { settings: { ...s.settings, textOnly: e.target.checked } }))} />仅文本</label>
              <label>
                思考
                <select
                  aria-label="解释窗思考强度"
                  value={
                    s.settings.reasoningEffort || defaultEffort(model)
                  }
                  onChange={(e) =>
                    r.guard(() =>
                      w.patch(s.id, {
                        settings: {
                          ...s.settings,
                          reasoningEffort: e.target.value,
                        },
                      }),
                    )
                  }
                >
                  {!s.settings.reasoningEffort && !defaultEffort(model) && (
                    <option value="">模型默认</option>
                  )}
                  {modelEfforts(model).map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.settings.webSearch ?? false}
                  onChange={(e) =>
                    r.guard(() =>
                      w.patch(s.id, {
                        settings: {
                          ...s.settings,
                          webSearch: e.target.checked,
                        },
                      }),
                    )
                  }
                />
                联网
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.settings.agentTools ?? true}
                  onChange={(e) =>
                    r.guard(() =>
                      w.patch(s.id, {
                        settings: {
                          ...s.settings,
                          agentTools: e.target.checked,
                        },
                      }),
                    )
                  }
                />
                阅读工具
              </label>
              <button
                disabled={!!active}
                onClick={() =>
                  r.guard(async () => {
                    await w.promote(s.id);
                    setNotice("已保存为正式对话");
                  })
                }
              >
                保存为正式对话
              </button>
              <button
                onClick={() => {
                  if (confirm("关闭这一支的所有解释窗，并清理临时内容？"))
                    r.guard(() => w.close(s.id, true));
                }}
              >
                关闭这一支
              </button>
            </div>
          )}
          <div
            ref={scroll}
            className="reading-scroll"
            onScroll={(e) => {
              const el = e.currentTarget;
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {s.selection.rect && (
              <button
                className="reading-crop"
                onClick={() =>
                  r.setImage(
                    s.selection.image
                      ? `/api/attachments/${s.selection.image}`
                      : renderUrl(
                          s.selection.documentId,
                          s.selection.page,
                          s.selection.rotation,
                          s.selection.rect,
                        ),
                  )
                }
              >
                <img
                  alt="点读选区"
                  src={
                    s.selection.image
                      ? `/api/attachments/${s.selection.image}`
                      : renderUrl(
                          s.selection.documentId,
                          s.selection.page,
                          s.selection.rotation,
                          s.selection.rect,
                          true,
                        )
                  }
                />
              </button>
            )}
            {turns.length === 0 && (
              <p className="chat-muted">已保留选区。点击下方发送开始解释。</p>
            )}
            {turns.map((t, i) => (
              <article className="reading-turn" key={t.id}>
                {i > 0 && <div className="reading-question">{t.question}</div>}
                <div
                  className="answer answer-v2"
                  onContextMenu={(e) => {
                    const text = selectedOrBlock(e, e.currentTarget);
                    if (!text) return;
                    e.preventDefault();
                    requestPointer({
                      parentId: s.id,
                      selection: {
                        ...s.selection,
                        id: crypto.randomUUID(),
                        kind: "answer",
                        rect: undefined,
                        rects: undefined,
                        image: undefined,
                        text,
                        turnId: t.id,
                      },
                      position: { x: e.clientX, y: e.clientY },
                    });
                  }}
                >
                  <RichAnswer
                    text={t.answer}
                    sources={sources}
                    navigate={r.navigateSource}
                  />
                </div>
                {t.state !== "completed" && (
                  <p className="reading-state">
                    {t.state === "preparing"
                      ? "排队／准备选区…"
                      : stateLabels[t.state]}
                  </p>
                )}
                {t.error && <p className="turn-error">{t.error}</p>}
                {t.tools?.length ? (
                  <details className="reading-tool-log">
                    <summary>查阅过程 · {t.tools.length} 项</summary>
                    {t.tools.map((tool) => (
                      <p key={tool.id}>
                        {tool.title} ·{" "}
                        {tool.state === "completed"
                          ? "完成"
                          : tool.state === "running"
                            ? "进行中"
                            : "未完成"}{" "}
                        {tool.detail}
                      </p>
                    ))}
                  </details>
                ) : null}
                {!!t.answer && (
                  <button
                    className="reading-copy"
                    onClick={() =>
                      r.guard(async () => {
                        await navigator.clipboard.writeText(
                          portableAnswer(
                            t.answer,
                            sources,
                            s.selection.documentName || "课件",
                          ),
                        );
                        setNotice("已复制");
                      })
                    }
                  >
                    复制
                  </button>
                )}
                {t.state === "completed" && <button className="reading-copy" onClick={() => requestSaveAnswer(t.id, "readingTurn")}>存为笔记</button>}
                {i === turns.length - 1 &&
                  !active &&
                  ["stopped", "failed", "unknown"].includes(t.state) && (
                    <div className="reading-suggestions">
                      {["stopped", "failed", "unknown"].includes(t.state) && (
                        <button onClick={() => void send(t.question)}>
                          重试此问题
                        </button>
                      )}
                    </div>
                  )}
              </article>
            ))}
          </div>
          <div className="reading-composer">
            {notice && <div role="status">{notice}</div>}
            {!w.connected && (
              <div role="status">连接中断，正在恢复。不会重复发送。</div>
            )}
            <div>
              <textarea
                aria-label="解释窗追问"
                value={draft}
                placeholder="继续提问…"
                maxLength={6000}
                onChange={(e) => saveDraft(e.target.value)}
                onBlur={() => {
                  clearTimeout(timer.current);
                  void w
                    .patch(s.id, { draft: latestDraft.current })
                    .catch(() => {});
                }}
                onCompositionStart={() => (composition.current = true)}
                onCompositionEnd={() => {
                  composition.current = false;
                  compositionEnd.current = Date.now();
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.repeat &&
                    !composition.current &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229 &&
                    Date.now() - compositionEnd.current > 100
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {active ? (
                <button
                  aria-label="停止解释"
                  onClick={() =>
                    r.guard(() =>
                      api(`/turns/${active.id}/stop`, { method: "POST" }),
                    )
                  }
                >
                  <Icon name="stop" size={16} />
                </button>
              ) : (
                <button
                  aria-label="发送解释窗问题"
                  disabled={!draft.trim() || sending || !w.connected}
                  onClick={() => void send()}
                >
                  <Icon name="send" size={17} />
                </button>
              )}
            </div>
          </div>
          {!narrow && (
            <button
              className="reading-resize"
              aria-label="调整解释窗大小"
              onPointerDown={(e) => begin(e, true)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={(e) => {
                if (e.key.startsWith("Arrow")) {
                  e.preventDefault();
                  saveLayout({
                    ...layout,
                    width: Math.max(
                      280,
                      layout.width +
                        (e.key === "ArrowRight"
                          ? 20
                          : e.key === "ArrowLeft"
                            ? -20
                            : 0),
                    ),
                    height: Math.max(
                      180,
                      layout.height +
                        (e.key === "ArrowDown"
                          ? 20
                          : e.key === "ArrowUp"
                            ? -20
                            : 0),
                    ),
                  });
                }
              }}
            >
              ◢
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function ReadingWindows({
  controller: w,
  r,
}: {
  controller: WindowsController;
  r: Reader;
}) {
  const [viewport, setViewport] = useState(window.innerWidth);
  useEffect(() => {
    const change = () => setViewport(window.innerWidth);
    window.addEventListener("resize", change);
    return () => window.removeEventListener("resize", change);
  }, []);
  const focused = w.sessions.some((s) => s.id === w.focused)
    ? w.focused
    : w.sessions.at(-1)?.id;
  return (
    <>
      {w.sessions.map((s) => (
        <Window
          key={s.id}
          session={s}
          turns={w.turns.filter((t) => t.readingSessionId === s.id)}
          controller={w}
          r={r}
          front={s.id === focused}
          narrow={viewport < 650}
        />
      ))}
      {!!w.sessions.length && (
        <details className="reading-window-switcher" aria-label="打开的解释窗">
          <summary>解释窗 {w.sessions.length}</summary>
          <nav aria-label="解释窗列表">
          {w.sessions.map((s) => (
            <button
              key={s.id}
              title={s.title}
              className={s.id === focused ? "active" : ""}
              onClick={() => {
                w.setFocused(s.id);
                if (s.layout.minimized)
                  r.guard(() =>
                    w.patch(s.id, {
                      layout: { ...s.layout, minimized: false },
                    }),
                  );
              }}
            >
              {s.title}
            </button>
          ))}
          </nav>
        </details>
      )}
    </>
  );
}
