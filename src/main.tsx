import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./style.css";
import { useReader } from "./useReader.ts";
import { PdfReader } from "./PdfReader.tsx";
import { WorkspaceSidebar } from "./WorkspaceSidebar.tsx";
import { OverviewWorkspace } from "./OverviewWorkspace.tsx";
import { MaterialsWorkspace } from "./MaterialsWorkspace.tsx";
import { HistoryWorkspace } from "./HistoryWorkspace.tsx";
import { CreateCourse } from "./CreateCourse.tsx";
import {
  readingShortcut,
  shortcutHelp,
  type ReadingAction,
} from "./readingInteractions.ts";
import { workspaceLabels, type WorkspaceView } from "./workspace.ts";
import { ChatPane } from "./ChatPane.tsx";
import { Icon, Tool, ResizeHandle } from "./controls.tsx";
import { api } from "./api.ts";
import { useReadingWindows } from "./useReadingWindows.ts";
import { ReadingWindows } from "./ReadingWindows.tsx";
import { NotesPane } from "./NotesPane.tsx";
import { useNotes } from "./useNotes.ts";
import { Welcome, LearningGuide, ConnectionSetup } from "./Onboarding.tsx";
import { AIConnectionCenter } from "./AIConnectionCenter.tsx";
import { ResearchWorkspace } from "./ResearchWorkspace.tsx";
import ManualPage from "./ManualPage.tsx";
import { useManual } from "./useManual.ts";
import { requestResearch, type ResearchRequest } from "./research.ts";
import "./ai.css";
import { chapterName } from "../shared/learning.ts";
import type { LearningNote } from "../shared/types.ts";
import type { PointerRequest } from "./selection.ts";
import "./power-pointer.css";
import "./workspace.css";
import "./learning.css";
import { applyChatFont, readChatFont } from "./chatFont.ts";
applyChatFont(readChatFont());
function useSaved<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  });
  const save = (next: T) => {
    setValue(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  return [value, save] as const;
}
function App() {
  const manual = useManual();
  const r = useReader();
  const reading = useReadingWindows(r);
  const notes = useNotes(r, reading.notesVersion);
  const [sideView, setSideView] = useState<"chat" | "notes">("chat");
  const [expanded, setExpanded] = useState(false), [guide, setGuide] = useState(false);
  const guideChecked = useRef(false), pendingNote = useRef<LearningNote | undefined>(undefined);
  useEffect(() => {
    if (!r.ready || guideChecked.current) return;
    guideChecked.current = true;
    if (!r.documents.length && !localStorage.getItem("pointer-guide-completed")) setGuide(true);
  }, [r.ready]);
  const [wheelEnabled, setWheelEnabled] = useSaved(
    "pointer-wheel-paging",
    true,
  );
  const [singleKeys, setSingleKeys] = useSaved(
    "pointer-single-key-shortcuts",
    true,
  );
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const pageField = useRef<HTMLInputElement>(null);
  const pageEditCancelled = useRef(false);
  const [creating, setCreating] = useState(false),
    [pointerMenu, setPointerMenu] = useState<PointerRequest>();
  useEffect(() => {
    const requested = (event: Event) =>
      setPointerMenu((event as CustomEvent<PointerRequest>).detail);
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".pointer-menu"))
        setPointerMenu(undefined);
    };
    window.addEventListener("pointer:request", requested);
    window.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("pointer:request", requested);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, []);
  useEffect(() => {
    setPointerMenu(undefined);
  }, [r.docId, r.doc?.page, r.doc?.rotation, r.doc?.zoom]);
  const [researchRequest, setResearchRequest] = useState<ResearchRequest>();
  useEffect(() => {
    const open = (event: Event) => { setResearchRequest((event as CustomEvent<ResearchRequest>).detail); r.setWorkspaceView("research"); };
    window.addEventListener("pointer:research", open);
    return () => window.removeEventListener("pointer:research", open);
  }, []);
  const [settings, setSettings] = useState(false),
    [showJobs, setShowJobs] = useState(false),
    [scale, setScale] = useState(1),
    [windowWidth, setWindowWidth] = useState(window.innerWidth),
    [pageInput, setPageInput] = useState("1");
  const [savedChatWidth, setChatWidth] = useSaved(
      "pointer-chat-width",
      (() => {
        try {
          const old = Number(localStorage.getItem("lecture-chat-width"));
          return old > 0 ? Math.max(320, Math.min(520, old)) : 390;
        } catch {
          return 390;
        }
      })(),
    ),
    [chatOpen, setChatOpen] = useSaved("lecture-chat-open", true),
    [navOpen, setNavOpen] = useSaved(
      "pointer-sidebar-open",
      window.innerWidth >= 1200,
    );
  const chatWidth = expanded && windowWidth >= 1200 ? 600 : Math.max(320, Math.min(520, savedChatWidth));
  const [mobileChat, setMobileChat] = useState(false),
    [navOverlay, setNavOverlay] = useState(false);
  const narrow = windowWidth < 900;
  useEffect(() => {
    setNavOverlay(false);
  }, [windowWidth < 1200]);
  const showChat = narrow ? mobileChat : chatOpen;
  const showNav = windowWidth >= 1200 ? navOpen && !(expanded && r.workspaceView === "reading") : navOverlay;
  const openNotes = (id?: string) => {
    r.setWorkspaceView("reading"); setSideView("notes"); setExpanded(false);
    if (narrow) setMobileChat(true); else setChatOpen(true);
    if (id) notes.open(id);
  };
  useEffect(() => {
    const connection = () => setSettings(true);
    const chat = () => { setSideView("chat"); if (narrow) setMobileChat(true); else setChatOpen(true); };
    const open = (event: Event) => openNotes((event as CustomEvent<string>).detail);
    const save = (event: Event) => r.guard(async () => {
      const note = await notes.create((event as CustomEvent<{ turnId: string; originKind: "turn" | "readingTurn" }>).detail);
      pendingNote.current = note;
      if ((note.courseId || "") !== r.courseId) r.setCourseId(note.courseId || "");
      if (!note.courseId && note.documentId) r.setDocId(note.documentId);
      openNotes(note.id);
    });
    window.addEventListener("pointer:connect", connection); window.addEventListener("pointer:open-note", open); window.addEventListener("pointer:save-answer", save);
    window.addEventListener("pointer:open-chat", chat);
    return () => { window.removeEventListener("pointer:open-chat", chat); window.removeEventListener("pointer:connect", connection); window.removeEventListener("pointer:open-note", open); window.removeEventListener("pointer:save-answer", save); };
  });
  useEffect(() => {
    const note = pendingNote.current;
    if (note && (note.courseId || "") === r.courseId && notes.notes.some(n => n.id === note.id)) { notes.open(note.id); pendingNote.current = undefined; }
  }, [r.courseId, notes.notes]);
  const closeNav = () => {
    if (windowWidth >= 1200) setNavOpen(false);
    setNavOverlay(false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="切换导航"]')
        ?.focus(),
    );
  };
  useEffect(() => {
    if (manual.route || !showNav || windowWidth >= 1200) return;
    const sidebar = document.querySelector<HTMLElement>(".workspace-sidebar");
    sidebar?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = [
        ...sidebar!.querySelectorAll<HTMLElement>(
          "button:not(:disabled),summary,input,select",
        ),
      ].filter((el) => el.offsetParent !== null);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => window.removeEventListener("keydown", trap);
  }, [showNav, windowWidth < 1200, !!manual.route]);
  const fit = (mode: "page" | "width") => r.change({ fitMode: mode, zoom: 0 });
  const zoom = (v: number) =>
    r.change({ fitMode: "custom", zoom: Math.max(0.1, Math.min(4, v)) });
  const toggleChat = () =>
    narrow ? setMobileChat(!mobileChat) : setChatOpen(!chatOpen);
  const closeChat = () => (narrow ? setMobileChat(false) : setChatOpen(false));
  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    setPageInput(String(r.doc?.page || 1));
  }, [r.doc?.page, r.docId]);
  const focusReader = () =>
    document
      .querySelector<HTMLElement>(".reader-surface")
      ?.focus({ preventScroll: true });
  const pageScroll = () => document.querySelector<HTMLElement>(".page-scroll");
  const stepPage = (direction: -1 | 1) => {
    if (!r.doc || pageScroll()?.getAttribute("aria-busy") === "true") return;
    r.go(r.doc.page + direction, direction < 0 ? "bottom" : "top");
  };
  const openSearch = () => {
    r.setSearchOpen(true);
    setNavOpen(true);
    if (windowWidth < 1200) setNavOverlay(true);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>('[aria-label="全文搜索"]')
        ?.focus(),
    );
  };
  const actions: Record<ReadingAction, () => void> = {
    text: () => r.setPointerMode("read"),
    box: () => r.setPointerMode("box"),
    search: openSearch,
    jump: () => {
      pageField.current?.focus();
      pageField.current?.select();
    },
    previous: () => stepPage(-1),
    next: () => stepPage(1),
    up: () => pageScroll()?.scrollBy({ top: -60, behavior: "instant" }),
    down: () => pageScroll()?.scrollBy({ top: 60, behavior: "instant" }),
    top: () => pageScroll()?.scrollTo({ top: 0, behavior: "instant" }),
    bottom: () =>
      pageScroll()?.scrollTo({
        top: pageScroll()?.scrollHeight,
        behavior: "instant",
      }),
    first: () => r.go(1),
    last: () => r.go(r.doc?.pages || 1),
    zoomIn: () => zoom(scale + 0.1),
    zoomOut: () => zoom(scale - 0.1),
    fitPage: () => fit("page"),
    fitWidth: () => fit("width"),
    help: () => setShortcutOpen(true),
  };
  const commitPage = (value: string) => {
    const n = /^\d+$/.test(value)
      ? Math.max(1, Math.min(r.doc?.pages || 1, Number(value)))
      : r.doc?.page || 1;
    setPageInput(String(n));
    r.go(n);
  };
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (manual.route) return;
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const target = e.target instanceof HTMLElement ? e.target : document.body;
      const openDetails = Array.from(
        document.querySelectorAll<HTMLDetailsElement>("details[open]"),
      ).filter((el) => el.getClientRects().length > 0);
      if (e.key === "Escape") {
        const detail =
          target.closest<HTMLDetailsElement>("details[open]") ||
          openDetails.at(-1);
        if (r.image) r.setImage("");
        else if (shortcutOpen) setShortcutOpen(false);
        else if (settings) setSettings(false);
        else if (pointerMenu) {
          setPointerMenu(undefined);
          focusReader();
        } else if (detail) {
          detail.open = false;
          detail.querySelector("summary")?.focus();
        } else if (target.closest('[role="dialog"],.chat-popup')) return;
        else if (navOverlay) closeNav();
        else if (showJobs) setShowJobs(false);
        else if (r.searchOpen && target.closest(".navigation")) {
          r.setSearchOpen(false);
          focusReader();
        } else if (
          target.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
          )
        )
          return;
        else if (r.workspaceView === "reading" && r.boxMode) {
          r.setBoxMode(false);
          focusReader();
        } else if (window.getSelection()?.toString())
          window.getSelection()?.removeAllRanges();
        else return;
        e.preventDefault();
        return;
      }
      const pageFocused =
        target === document.body ||
        target.matches(".reader-surface,.page-scroll,.pdf-page") ||
        (!!target.closest(".reader-surface") &&
          !target.closest("button,a,input,select,textarea,[role=separator]"));
      const context = {
        active:
          r.workspaceView === "reading" &&
          !!r.doc &&
          !(r.course && !r.course.documentIds.length) &&
          !(narrow && mobileChat),
        blocked:
          !!target.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role=dialog],[role=menu],details[open]',
          ) ||
          !!document.querySelector('[aria-modal="true"],.pointer-menu') ||
          openDetails.length > 0 ||
          navOverlay,
        pageFocused,
        singleKeys,
      };
      const action = readingShortcut(e, context);
      if (action) {
        e.preventDefault();
        actions[action]();
      } else if (e.repeat && readingShortcut(e, context, true))
        e.preventDefault();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  useEffect(() => {
    if (manual.route || !settings && !r.image && !shortcutOpen) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector(
      '[role=dialog][aria-modal="true"]',
    ) as HTMLElement;
    const targets = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
        ) || [],
      ).filter(element => element.getClientRects().length > 0);
    targets()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = targets();
      if (!list.length) return;
      const first = list[0],
        last = list.at(-1)!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [settings, r.image, shortcutOpen, !!manual.route]);
  useEffect(() => {
    const outside = (e: PointerEvent) =>
      document.querySelectorAll("details.popover[open]").forEach((d) => {
        if (!d.contains(e.target as Node)) d.removeAttribute("open");
      });
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const fullscreen = () => {
    r.guard(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    });
  };
  const activeJobs = r.jobs.filter((j) =>
    ["queued", "processing"].includes(j.state),
  );
  return (
    <>
    <div
      className={`app ${expanded ? "explanation-expanded" : ""} ${manual.route ? "manual-covered" : ""}`}
      inert={manual.route ? true : undefined}
      aria-hidden={manual.route ? true : undefined}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button"))
          target.closest("details.popover")?.removeAttribute("open");
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setShowJobs(true);
          void r.importFile(e.dataTransfer.files[0]);
        }
      }}
    >
      {showNav && (
        <>
          <WorkspaceSidebar
            r={r}
            progress={reading.knowledgeProgress}
            onCreate={() => {
              setCreating(true);
              setNavOverlay(false);
            }}
            onSettings={() => setSettings(true)}
            onClose={() => {
              closeNav();
            }}
          />
          {windowWidth < 1200 && (
            <button
              className="nav-scrim"
              aria-label="关闭导航"
              onClick={closeNav}
            />
          )}
        </>
      )}
      <div
        className="workspace-body"
        inert={showNav && windowWidth < 1200 ? true : undefined}
      >
        <header className="reading-toolbar">
          <button
            aria-label="切换导航"
            aria-expanded={showNav}
            onClick={() => {
              setExpanded(false);
              windowWidth >= 1200
                ? setNavOpen(!navOpen)
                : setNavOverlay(!navOverlay);
            }}
          >
            <Icon name="list" size={19} />
          </button>
          <nav className="workspace-tabs" aria-label="工作区">
            {(Object.entries(workspaceLabels) as [WorkspaceView, string][]).map(
              ([view, label]) => (
                <button
                  key={view}
                  aria-current={r.workspaceView === view ? "page" : undefined}
                  onClick={() => {
                    r.setWorkspaceView(view);
                    setNavOverlay(false);
                  }}
                >
                  <Icon
                    name={
                      {
                        reading: "file",
                        overview: "list",
                        materials: "slides",
                        history: "history",
                        research: "steps",
                      }[view]
                    }
                    size={18}
                  />
                  {label}
                  {view === "overview" &&
                    r.course?.knowledgeStale &&
                    r.course.knowledgeRevisionId && (
                      <span
                        className="nav-status"
                        title="总览待更新"
                        aria-label="总览待更新"
                      />
                    )}
                </button>
              ),
            )}
          </nav>
          <span
            className="toolbar-title"
            title={r.workspaceView === "reading" ? r.doc?.name : r.course?.name}
          >
            {r.workspaceView === "reading"
              ? r.doc ? chapterName(r.course, r.doc) : "阅读"
              : workspaceLabels[r.workspaceView]}
          </span>
          {r.workspaceView === "reading" && (
            <>
              <div className="reader-tools">
                <button
                  disabled={!r.doc}
                  aria-pressed={!r.boxMode}
                  onClick={actions.text}
                  title="选字 (V)"
                  aria-keyshortcuts="V"
                >
                  <Icon name="text" size={16} />
                  <span>选字</span>
                </button>
                <button
                  disabled={!r.doc}
                  aria-pressed={r.boxMode}
                  onClick={actions.box}
                  title="框选 (B)"
                  aria-keyshortcuts="B"
                >
                  <Icon name="box" size={16} />
                  <span>框选</span>
                </button>
                <button
                  disabled={!r.doc}
                  onClick={actions.search}
                  title="搜索课件 (Ctrl/Cmd + F)"
                  aria-keyshortcuts="Control+F Meta+F"
                >
                  <Icon name="search" size={16} />
                  <span>搜索</span>
                </button>
                <details className="popover">
                  <summary>
                    适配
                    <Icon name="down" size={12} />
                  </summary>
                  <div className="popover-panel">
                    <button
                      disabled={!r.doc}
                      onClick={actions.fitPage}
                      title="适合页面 (0)"
                      aria-keyshortcuts="0"
                    >
                      适合页面
                    </button>
                    <button
                      disabled={!r.doc}
                      onClick={actions.fitWidth}
                      title="适合宽度 (Shift + 0)"
                      aria-keyshortcuts="Shift+0"
                    >
                      适合宽度
                    </button>
                  </div>
                </details>
                <details className="popover">
                  <summary aria-label="更多阅读操作">
                    <Icon name="more" size={18} />
                  </summary>
                  <div className="popover-panel">
                    <button
                      disabled={!r.doc}
                      onClick={() =>
                        r.change({
                          rotation: ((r.doc?.rotation || 0) + 90) % 360,
                        })
                      }
                    >
                      旋转页面
                    </button>
                    <button onClick={fullscreen}>全屏</button>
                    <label className="menu-check">
                      <input
                        type="checkbox"
                        checked={wheelEnabled}
                        onChange={(e) => setWheelEnabled(e.target.checked)}
                      />
                      滚轮翻页
                    </label>
                    <button
                      onClick={actions.help}
                      title="快捷键帮助 (?)"
                      aria-keyshortcuts="Shift+/"
                    >
                      快捷键帮助 <kbd>?</kbd>
                    </button>
                    <button onClick={() => r.fileInput.current?.click()}>
                      添加资料
                    </button>
                  </div>
                </details>
              </div>
              {!narrow && <button
                className="chat-toggle"
                aria-pressed={showChat}
                onClick={toggleChat}
              >
                <Icon name="chat" size={17} />
                {sideView === "notes" ? "笔记" : "对话"}
              </button>}
              {narrow && <div className="mobile-reading-tabs" aria-label="阅读面板"><button aria-pressed={!mobileChat} onClick={() => setMobileChat(false)}>原文</button><button aria-pressed={mobileChat && sideView === "chat"} onClick={() => { setSideView("chat"); setMobileChat(true); }}>对话</button><button aria-pressed={mobileChat && sideView === "notes"} onClick={() => openNotes()}>笔记</button></div>}
            </>
          )}
          <details className="popover help-menu"><summary aria-label="帮助"><Icon name="info" size={18} /></summary><div className="popover-panel"><button onClick={event => manual.open(undefined, event.currentTarget)}>使用手册</button><button onClick={() => setGuide(true)}>阅读引导</button><button onClick={() => setShortcutOpen(true)}>快捷键</button><button onClick={() => setSettings(true)}>连接与环境检查</button></div></details>
        </header>
        <input
          ref={r.fileInput}
          type="file"
          accept=".pdf,.ppt,.pptx,application/pdf"
          hidden
          onChange={(e) => {
            setShowJobs(true);
            void r.importFile(e.target.files?.[0]);
          }}
        />
        {r.error && (
          <div className="error-banner" role="alert">
            <span>{r.error}</span>
            <button aria-label="关闭提示" onClick={() => r.setError("")}>
              ×
            </button>
          </div>
        )}
        {guide && <LearningGuide r={r} hasSelection={!!pointerMenu} hasNote={!!notes.notes.length} onNotes={() => openNotes()} onManual={() => manual.open("start")} onClose={() => { setGuide(false); localStorage.setItem("pointer-guide-completed", "true"); }} />}
        <div
          className={`reading-scene ${narrow && mobileChat ? "mobile-chat" : ""}`}
          hidden={r.workspaceView !== "reading"}
        >
          {!r.doc || (r.course && !r.course.documentIds.length) ? (
            <Welcome r={r} onGuide={() => setGuide(true)} onManual={() => manual.open("start")} />
          ) : (
            <main
              className="workspace"
              style={
                {
                  "--chat-width": `${chatWidth}px`,
                } as React.CSSProperties
              }
            >
              <section
                className="reader-surface"
                tabIndex={0}
                aria-label="课件阅读区"
              >
                <PdfReader
                  doc={r.doc}
                  interactionEnabled={
                    !manual.route && r.workspaceView === "reading" && !(narrow && mobileChat)
                  }
                  wheelEnabled={wheelEnabled}
                  onZoom={zoom}
                  pageArrival={r.pageArrival}
                  onPageStep={stepPage}
                  boxMode={r.boxMode}
                  notes={notes.notes}
                  onNote={openNotes}
                  selections={r.sourceHighlight?.documentId === r.docId && r.sourceHighlight.page === r.doc.page ? r.sourceHighlight.rects : undefined}
                  selection={
                    (pointerMenu?.selection.kind === "rectangle" &&
                    pointerMenu.selection.documentId === r.docId &&
                    pointerMenu.selection.page === r.doc.page
                      ? pointerMenu.selection.rect
                      : undefined) ||
                    (r.sourceHighlight?.documentId === r.docId &&
                    r.sourceHighlight.page === r.doc.page
                      ? r.sourceHighlight.rect
                      : undefined)
                  }
                  onScale={setScale}
                  onSelect={(text, area, anchor, rects) => {
                    if (text.trim() || area) {
                      r.setBoxMode(false);
                      const selection = {
                        id: crypto.randomUUID(),
                        kind: text.trim() ? "text" as const : "rectangle" as const,
                        documentId: r.doc!.id,
                        documentName: r.doc!.name,
                        page: r.doc!.page,
                        rotation: r.doc!.rotation,
                        rect: area,
                        rects,
                        text,
                      };
                      if (!text) window.getSelection()?.removeAllRanges();
                      setPointerMenu({
                        selection,
                        position: anchor || { x: windowWidth / 2, y: 200 },
                      });
                    }
                  }}
                  onError={r.setError}
                />
              </section>
              <div className="chat-region" hidden={!showChat}>
                {!narrow && (
                  <ResizeHandle
                    label="调整问答宽度"
                    value={chatWidth}
                    min={320}
                    max={520}
                    direction={-1}
                    onChange={value => { setExpanded(false); setChatWidth(value); }}
                  />
                )}
                <div className="side-tabs" aria-label="阅读侧栏"><button aria-pressed={sideView === "chat"} onClick={() => setSideView("chat")}>对话</button><button aria-pressed={sideView === "notes"} onClick={() => { setSideView("notes"); setExpanded(false); }}>笔记</button><span className="flex-space" />{sideView === "notes" && <button aria-label="收起笔记" onClick={closeChat}><Icon name="close" size={16} /></button>}</div>
                <div className="side-pane" hidden={sideView !== "chat"}><ChatPane r={r} onClose={closeChat} expanded={expanded} onExpand={setExpanded} /></div>
                <div className="side-pane" hidden={sideView !== "notes"}><NotesPane r={r} notes={notes} onNavigate={() => { if (narrow) setMobileChat(false); }} /></div>
              </div>
            </main>
          )}
          <footer className="statusbar">
            <div className="page-controls">
              <Tool
                icon="left"
                title="上一页 (← / Page Up)"
                shortcut="ArrowLeft PageUp"
                disabled={!r.doc || r.doc.page === 1}
                onClick={actions.previous}
              />
              <label>
                <span className="page-label">第</span>
                <input
                  ref={pageField}
                  aria-label="页码"
                  title="跳到页码 (G)"
                  aria-keyshortcuts="G"
                  onFocus={() => {
                    pageEditCancelled.current = false;
                  }}
                  inputMode="numeric"
                  value={pageInput}
                  disabled={!r.doc}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => {
                    if (!pageEditCancelled.current) commitPage(pageInput);
                    pageEditCancelled.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.nativeEvent.isComposing ||
                      e.nativeEvent.keyCode === 229
                    )
                      return;
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      pageEditCancelled.current = true;
                      setPageInput(String(r.doc?.page || 1));
                      focusReader();
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      pageEditCancelled.current = true;
                      commitPage(pageInput);
                      focusReader();
                    }
                  }}
                />
                <span>/ {r.doc?.pages || 0} 页</span>
              </label>
              <Tool
                icon="right"
                title="下一页 (→ / Page Down)"
                shortcut="ArrowRight PageDown"
                disabled={!r.doc || r.doc.page === r.doc.pages}
                onClick={actions.next}
              />
            </div>
            {r.doc && (
              <details className="popover index-info">
                <summary>
                  {r.doc.indexStatus === "indexing"
                    ? "正在索引…"
                    : r.doc.indexStatus === "failed"
                      ? "索引失败"
                      : (r.doc.sourceFormat || "pdf").toUpperCase()}
                </summary>
                <div className="popover-panel">
                  <p>
                    可检索文字：{r.doc.indexedPages}/{r.doc.pages} 页
                  </p>
                  {r.doc.indexedPages < r.doc.pages && (
                    <p>无文字的页面可使用图像问答。</p>
                  )}
                  {r.doc.sourceFormat && r.doc.sourceFormat !== "pdf" && (
                    <p>静态阅读，动画和视频不播放。</p>
                  )}
                  {r.doc.importEngine === "libreoffice" && (
                    <p>使用兼容引擎，排版可能存在差异。</p>
                  )}
                  <button
                    onClick={() =>
                      r.guard(async () => {
                        await api(`/documents/${r.doc!.id}/reindex`, {
                          method: "POST",
                        });
                        r.change({ indexStatus: "indexing" });
                      })
                    }
                  >
                    重建索引
                  </button>
                </div>
              </details>
            )}
            <div className="flex-space" />
            {!!r.jobs.length && (
              <button
                className="import-status"
                onClick={() => setShowJobs(!showJobs)}
              >
                {activeJobs.length ? `导入中 ${activeJobs.length}` : "导入记录"}
              </button>
            )}
            <div className="zoom-controls">
              <Tool
                icon="fit"
                title="适合页面 (0)"
                shortcut="0"
                disabled={!r.doc}
                onClick={actions.fitPage}
              />
              <button
                title="缩小 (−)"
                aria-keyshortcuts="-"
                disabled={!r.doc}
                onClick={actions.zoomOut}
              >
                −
              </button>
              <input
                aria-label="缩放滑块"
                type="range"
                min="10"
                max="400"
                value={Math.round(scale * 100)}
                disabled={!r.doc}
                onChange={(e) => zoom(Number(e.target.value) / 100)}
              />
              <button
                title="放大 (+)"
                aria-keyshortcuts="+"
                disabled={!r.doc}
                onClick={actions.zoomIn}
              >
                +
              </button>
              <button
                className="zoom-value"
                onClick={actions.fitWidth}
                title="适合宽度 (Shift + 0)"
                aria-keyshortcuts="Shift+0"
                disabled={!r.doc}
              >
                {Math.round(scale * 100)}%
              </button>
            </div>
          </footer>
        </div>
        {r.workspaceView === "overview" && (
          <OverviewWorkspace
            key={r.courseId}
            r={r}
            windows={reading}
            onCreate={() => setCreating(true)}
          />
        )}
        {r.workspaceView === "materials" && (
          <MaterialsWorkspace
            key={r.courseId}
            r={r}
            windows={reading}
            onCreate={() => setCreating(true)}
          />
        )}
        {r.workspaceView === "history" && <HistoryWorkspace r={r} />}
        {r.workspaceView === "research" && <ResearchWorkspace key={r.courseId || r.docId} r={r} request={researchRequest} onConsumed={() => setResearchRequest(undefined)} />}
      </div>
      <ReadingWindows controller={reading} r={r} />
      {creating && <CreateCourse r={r} onClose={() => setCreating(false)} />}
      {pointerMenu && (
        <div
          className="pointer-menu"
          role="menu"
          aria-label="选区操作"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const items = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            items[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : (index + (e.key === "ArrowUp" ? -1 : 1) + items.length) %
                    items.length
            ]?.focus();
          }}
          style={{
            left: Math.max(
              8,
              Math.min(windowWidth - 230, pointerMenu.position.x),
            ),
            top: Math.max(
              8,
              Math.min(window.innerHeight - 130, pointerMenu.position.y),
            ),
          }}
        >
          {pointerMenu.imageOnly ? (
            <>
              <p>图片或扫描内容请框选</p>
              <button
                role="menuitem"
                onClick={() => {
                  r.setPointerMode("box");
                  setPointerMenu(undefined);
                }}
              >
                开始框选
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                autoFocus
                onClick={() => {
                  if (!r.requireAI()) return;
                  const request = pointerMenu;
                  setPointerMenu(undefined);
                  window.getSelection()?.removeAllRanges();
                  r.guard(() => reading.open(request));
                }}
              >
                弹窗解释
              </button>
              <button role="menuitem" onClick={() => {
                const request = pointerMenu; setPointerMenu(undefined);
                r.guard(async () => { const note = await notes.create({ anchor: request.selection }); window.getSelection()?.removeAllRanges(); openNotes(note.id); });
              }}>记笔记</button>
              <button role="menuitem" onClick={() => { const selection = pointerMenu.selection; setPointerMenu(undefined); window.getSelection()?.removeAllRanges(); requestResearch({ selection, goal: selection.text ? `深入解释并核查这段内容：${selection.text.slice(0, 1000)}` : "分析这个选区中的内容，核对条件与依据，并整理结论。" }); }}>围绕选区研究</button>
              <button
                role="menuitem"
                onClick={() => {
                  const request = pointerMenu;
                  setPointerMenu(undefined);
                  r.guard(async () => {
                    await r.addReference(request.selection);
                    setSideView("chat");
                    if (narrow) setMobileChat(true);
                    else setChatOpen(true);
                    window.getSelection()?.removeAllRanges();
                    r.input.current?.focus();
                  });
                }}
              >
                对话引用
              </button>
            </>
          )}
        </div>
      )}
      {showJobs && r.jobs.length > 0 && (
        <section className="import-tray" aria-label="导入任务">
          <div className="pane-heading">
            <strong>导入课件</strong>
            <Tool
              icon="close"
              title="收起导入记录"
              onClick={() => setShowJobs(false)}
            />
          </div>
          {r.jobs
            .slice(-8)
            .reverse()
            .map((j) => (
              <div className="import-job" key={j.id}>
                <div className="job-title">
                  <Icon name="file" />
                  <span title={j.name}>{j.name}</span>
                  <small>
                    {
                      {
                        queued: "等待处理",
                        processing: "正在处理",
                        completed: "完成",
                        failed: "失败",
                        cancelled: "已取消",
                      }[j.state]
                    }
                  </small>
                </div>
                {j.error && <p className="turn-error">{j.error}</p>}
                <div className="job-actions">
                  {["queued", "processing"].includes(j.state) ? (
                    <button
                      onClick={() =>
                        r.guard(async () => {
                          await api(`/imports/${j.id}/cancel`, {
                            method: "POST",
                          });
                          await r.refreshJobs();
                        })
                      }
                    >
                      取消
                    </button>
                  ) : ["failed", "cancelled"].includes(j.state) ? (
                    <>
                      <button
                        onClick={() => r.guard(() => r.retryImport(j.id))}
                      >
                        重试
                      </button>
                      {j.format !== "pdf" && r.office.libreoffice && (
                        <button
                          title="排版可能存在差异"
                          onClick={() =>
                            r.guard(() => r.retryImport(j.id, "libreoffice"))
                          }
                        >
                          使用兼容引擎重试
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        if (j.documentId) r.setDocId(j.documentId);
                        setShowJobs(false);
                      }}
                    >
                      打开
                    </button>
                  )}
                </div>
              </div>
            ))}
        </section>
      )}
      {shortcutOpen && (
        <div className="modal-backdrop" onClick={() => setShortcutOpen(false)}>
          <section
            className="settings-panel shortcut-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="快捷键帮助"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pane-heading">
              <strong>快捷键</strong>
              <button
                aria-label="关闭快捷键帮助"
                onClick={() => setShortcutOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="settings-content">
              <label className="menu-check">
                <input
                  type="checkbox"
                  checked={singleKeys}
                  onChange={(e) => setSingleKeys(e.target.checked)}
                />
                启用单键快捷键
              </label>
              <p>
                阅读工作区内可用；输入文字、操作菜单或弹窗时不会触发。翻页与滚动按键仅在课件区域生效。
              </p>
              <table>
                <tbody>
                  {shortcutHelp.map(([key, label]) => (
                    <tr key={key}>
                      <td>
                        <kbd>{key}</kbd>
                      </td>
                      <td>{label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="settings-panel ai-settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="设置"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pane-heading">
              <strong>设置</strong>
              <Tool
                icon="close"
                title="关闭设置"
                onClick={() => setSettings(false)}
              />
            </div>
            <AIConnectionCenter r={r} environment={<ConnectionSetup r={r} onGuide={() => { setSettings(false); setGuide(true); }} />} />
          </section>
        </div>
      )}
      {r.image && (
        <div
          className="image-modal"
          role="dialog"
          aria-modal="true"
          aria-label="查看附带图像"
          onClick={() => r.setImage("")}
        >
          <button aria-label="关闭图像" onClick={() => r.setImage("")}>
            <Icon name="close" />
          </button>
          <img src={r.image} alt="实际页面或选区图像" />
        </div>
      )}
    </div>
    {manual.route && <ManualPage route={manual.route} onClose={manual.close} />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
