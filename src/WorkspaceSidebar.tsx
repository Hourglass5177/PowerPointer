import { useEffect, useState } from "react";
import type { Reader } from "./useReader.ts";
import { Navigation } from "./Navigation.tsx";
import { Icon } from "./controls.tsx";
import { chapterName, courseSections, chapterStateLabels } from "../shared/learning.ts";
import type { ReadingWindows } from "./useReadingWindows.ts";

export function WorkspaceSidebar({
  r,
  onCreate,
  onSettings,
  onClose,
  progress = [],
}: {
  r: Reader;
  onCreate: () => void;
  onSettings: () => void;
  onClose: () => void;
  progress?: ReadingWindows["knowledgeProgress"];
}) {
  const [section, setSection] = useState<"files" | "pages">(() =>
    localStorage.getItem("pointer-sidebar-section") === "pages"
      ? "pages"
      : "files",
  );
  useEffect(
    () => localStorage.setItem("pointer-sidebar-section", section),
    [section],
  );
  useEffect(() => {
    if (r.searchOpen) setSection("pages");
  }, [r.searchOpen]);
  const chooseCourse = (id: string) => {
    r.setCourseId(id);
  };
  const chapterStates = new Map(progress.filter(p => p.courseId === r.courseId).flatMap(p => p.chapters || []).map(c => [c.documentId, c]));
  const sections = r.course ? courseSections(r.course) : [{ id: "recent", name: "最近阅读", documentIds: r.documents.filter(d => !d.hiddenRecent || d.id === r.docId).map(d => d.id) }];
  return (
    <aside className="workspace-sidebar" aria-label="工作区导航">
      <div className="sidebar-brand">
        <Icon name="slides" size={20} />
        <span>Power Pointer</span>
        <button
          className="sidebar-close"
          aria-label="收起导航"
          onClick={onClose}
        >
          <Icon name="collapse" size={16} />
        </button>
      </div>
      <details className="popover course-menu">
        <summary>
          <span>{r.course?.name || "独立课件"}</span>
          <Icon name="down" size={14} />
        </summary>
        <div className="popover-panel">
          <button
            onClick={(e) => {
              chooseCourse("");
              e.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            独立课件
          </button>
          {r.courses.map((c) => (
            <button
              key={c.id}
              aria-current={r.courseId === c.id ? "true" : undefined}
              onClick={(e) => {
                chooseCourse(c.id);
                e.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              {c.name}
            </button>
          ))}
          <button
            onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
              onCreate();
            }}
          >
            <Icon name="plus" size={16} />
            新建课程
          </button>
        </div>
      </details>
      {r.workspaceView === "reading" && (
        <div className="sidebar-library">
          <div className="sidebar-sections" aria-label="阅读导航">
            <button
              aria-pressed={section === "files"}
              onClick={() => {
                setSection("files");
                r.setSearchOpen(false);
              }}
            >
              课件
            </button>
            <button
              aria-pressed={section === "pages"}
              disabled={!r.doc}
              onClick={() => setSection("pages")}
            >
              页面
            </button>
            <button
              className="sidebar-add"
              aria-label="添加课件"
              onClick={() => r.fileInput.current?.click()}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>
          {section === "pages" ? (
            <Navigation r={r} />
          ) : (
            <div className="sidebar-files">
              {sections.map(section => <div className="sidebar-chapter-group" key={section.id}><h3>{section.name}</h3>{section.documentIds.map(id => r.documents.find(d => d.id === id)).filter(d => !!d).map((d) => (
                  <button
                    key={d.id}
                    title={d.name}
                    aria-current={r.docId === d.id ? "page" : undefined}
                    onClick={() => {
                      r.setDocId(d.id);
                      if (window.innerWidth < 1200) onClose();
                    }}
                  >
                    <Icon name="file" size={16} />
                    <span className="sidebar-chapter-text"><strong>{chapterName(r.course, d)}</strong><small>{d.pages} 页 · {r.course?.readingPosition?.documentId === d.id ? `读到 ${r.course.readingPosition.page} 页` : r.docId === d.id ? `第 ${d.page} 页` : chapterStateLabels[chapterStates.get(d.id)?.state || "queued"]}</small></span>
                    {chapterStates.get(d.id)?.state === "completed" && <span className="chapter-ready-mark" title="已整理">✓</span>}
                  </button>
                ))}</div>)}
              {!(r.course ? r.course.documentIds.length : r.documents.length) && <p className="muted">暂无可阅读的课件，请到资料页查看导入进度。</p>}
            </div>
          )}
        </div>
      )}
      <div className="sidebar-bottom">
        <button onClick={onSettings}>
          <Icon name="settings" size={17} />
          设置
          {!r.auth.authenticated && !r.ai.config?.connections.some(c => c.enabled && c.protocol !== "codex" && c.models.length) && (
            <span className="status-dot" title="未连接账户" />
          )}
        </button>
      </div>
    </aside>
  );
}
