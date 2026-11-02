import { useEffect, useState } from "react";
import type { Reader } from "./useReader.ts";
import type { ReadingWindows } from "./useReadingWindows.ts";
import type { KnowledgeRevision, KnowledgeReadSession, LearningNote, AISettings, Source } from "../shared/types.ts";
import { chapterName, chapterResults, chapterStateLabels, courseSections, summaryNeedsRefresh } from "../shared/learning.ts";
import { api } from "./api.ts";
import { RichAnswer } from "./RichAnswer.tsx";
import { Icon } from "./controls.tsx";
import { CourseImports } from "./CourseImports.tsx";
import { requestOpenNote } from "./useNotes.ts";
import { ModelSelect, selectedModel, ProfileButtons } from "./AIControls.tsx";
import { defaultEffort, modelEfforts } from "../shared/ai.ts";
import { plainPreview } from "../shared/markdown.ts";
import { ReadingSeedLabel } from "./ReadingSeedLabel.tsx";

export function OverviewWorkspace({ r, windows: w, onCreate }: { r: Reader; windows: ReadingWindows; onCreate: () => void }) {
  const course = r.course;
  const [revisions, setRevisions] = useState<KnowledgeRevision[]>([]), [notes, setNotes] = useState<LearningNote[]>([]);
  const [tab, setTab] = useState("章节目录"), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [settings, setSettings] = useState<AISettings>(w.settings), [force, setForce] = useState(false);
  const [scope, setScope] = useState("current"), [selected, setSelected] = useState<string[]>(r.docId ? [r.docId] : []);
  const [history, setHistory] = useState("");
  const [recordId, setRecordId] = useState(""), [record, setRecord] = useState<KnowledgeReadSession>();
  const progresses = w.knowledgeProgress.filter(p => p.courseId === course?.id);
  const resultVersion = progresses.map(p => `${p.id}:${p.resultVersion}`).join("|");
  useEffect(() => {
    let disposed = false;
    if (recordId && tab === "阅读记录") api<KnowledgeReadSession>(`/knowledge/sessions/${recordId}`).then(value => !disposed && setRecord(value)).catch(e => !disposed && setError(e.message));
    return () => { disposed = true; };
  }, [recordId, tab, resultVersion]);
  useEffect(() => { setRecordId(""); setRecord(undefined); }, [course?.id]);
  const load = async () => { if (course) setRevisions(await api<KnowledgeRevision[]>(`/courses/${course.id}/knowledge`)); };
  useEffect(() => {
    let disposed = false;
    if (!course) { setRevisions([]); setLoading(false); return; }
    api<KnowledgeRevision[]>(`/courses/${course.id}/knowledge`).then(list => { if (!disposed) { setRevisions(list); setError(""); } }).catch(e => !disposed && setError(e.message)).finally(() => !disposed && setLoading(false));
    return () => { disposed = true; };
  }, [course?.id, resultVersion]);
  useEffect(() => {
    let disposed = false;
    if (course) api<LearningNote[]>(`/courses/${course.id}/notes`).then(list => !disposed && setNotes(list)).catch(e => !disposed && setError(e.message));
    return () => { disposed = true; };
  }, [course?.id, w.notesVersion]);
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!course) return <main className="workspace-page"><div className="workspace-empty"><h1>把一门课放在一起</h1><p>每份课件就是一个章节。创建课程后，可以从当前章开始整理。</p><button className="primary" onClick={onCreate}>新建课程</button></div></main>;
  const recent = [...revisions].sort((a, b) => (a.updatedAt || a.createdAt).localeCompare(b.updatedAt || b.createdAt)).at(-1);
  const active = progresses.find(p => p.state === "building");
  const live = active || progresses.find(p => p.id === recent?.id);
  const task = revisions.find(p => p.id === live?.id) || recent;
  const building = !!active;
  const currentId = course.selectedDocumentIds.includes(r.docId) ? r.docId : course.selectedDocumentIds[0];
  const targets = scope === "all" ? course.selectedDocumentIds : scope === "selected" ? selected.filter(id => course.selectedDocumentIds.includes(id)) : currentId ? [currentId] : [];
  const targetPages = targets.reduce((n, id) => n + (r.documents.find(d => d.id === id)?.pages || 0), 0);
  const results = chapterResults(revisions, course.documentIds);
  const statuses = new Map(progresses.flatMap(p => p.chapters || []).map(c => [c.documentId, c]));
  if (live) for (const chapter of live.chapters || []) statuses.set(chapter.documentId, chapter);
  const completedPages = [...results.values()].filter(x => course.selectedDocumentIds.includes(x.chapter.documentId)).reduce((n, x) => n + (x.chapter.summaryCompleted ?? x.chapter.completed ?? x.revision.pages.filter(p => p.documentId === x.chapter.documentId && p.state === "completed").length), 0);
  const totalPages = course.selectedDocumentIds.reduce((n, id) => n + (r.documents.find(d => d.id === id)?.pages || 0), 0);
  const model = selectedModel(r.models, settings, r.ai.config?.preferences.defaultConnectionId);
  const resumeDoc = r.documents.find(d => d.id === course.readingPosition?.documentId) || r.documents.find(d => d.id === course.documentIds[0]);
  const summaryRevision = [...revisions].filter(k => k.summary).sort((a, b) => (a.summaryUpdatedAt || a.createdAt).localeCompare(b.summaryUpdatedAt || b.createdAt)).at(-1);
  const summaryStale = summaryRevision && summaryNeedsRefresh(summaryRevision, results, course.selectedDocumentIds);
  const sources = (revision: KnowledgeRevision) => new Map([...revision.pages.flatMap(p => p.sources), ...(revision.overviewChapters || revision.chapters).flatMap(c => c.sources || []), ...(revision.frameworkSources || [])].map(s => [s.id, s]));
  const answer = (text: string, map: Map<string, Source>) => <div className="answer answer-v2"><RichAnswer text={text} sources={map} navigate={r.navigateSource} /></div>;
  const start = (overviewOnly = false) => {
    if (!r.requireAI()) return;
    void perform(() => api(`/courses/${course.id}/knowledge`, { method: "POST", body: JSON.stringify({ ...settings, force, ...(overviewOnly ? { overviewOnly: true } : scope !== "all" ? { documentIds: targets } : {}) }) }));
  };
  const historyRevision = revisions.find(k => k.id === history) || recent;
  return <main className="workspace-page overview-page" aria-busy={busy || loading}>
    <header className="page-heading"><div><span className="page-eyebrow">继续学习</span><h1>{course.name}</h1><p>{course.documentIds.length} 个章节 · 已整理 {results.size} 章 · 覆盖 {completedPages}/{totalPages} 页</p></div><button onClick={() => r.setWorkspaceView("materials")}>管理资料</button></header>
    <CourseImports r={r} />
    {resumeDoc && <section className="continue-reading"><div><span>上次读到</span><h2>{chapterName(course, resumeDoc)}</h2><p>第 {course.readingPosition?.documentId === resumeDoc.id ? course.readingPosition.page : resumeDoc.page} 页 / 共 {resumeDoc.pages} 页</p></div><button className="primary" onClick={() => r.navigateSource(course.readingPosition?.documentId === resumeDoc.id ? course.readingPosition.page : resumeDoc.page, resumeDoc.id)}>继续阅读 <Icon name="right" size={16} /></button></section>}
    <section className="chapter-task-controls" aria-label="章节整理">
      <div className="chapter-task-top"><div><h2>连续阅读课件</h2><p>先建立课程框架，再逐章阅读图文；每批保存进度，随时暂停。</p></div><div className="page-actions">
        <select aria-label="整理范围" value={scope} disabled={building} onChange={e => setScope(e.target.value)}><option value="current">当前章节</option><option value="selected">所选章节</option><option value="all">全部问答来源</option></select>
        <details className="popover"><summary aria-label="整理设置"><Icon name="settings" size={18} /></summary><div className="popover-panel overview-settings">
          <ProfileButtons ai={r.ai} onChange={value => !building && setSettings(value)} /><label>模型<ModelSelect models={r.models} value={settings} ai={r.ai} onChange={value => !building && setSettings({ ...settings, ...value })} /></label>
          <label>思考强度<select aria-label="整理思考强度" value={settings.reasoningEffort || defaultEffort(model)} disabled={building} onChange={e => setSettings({ ...settings, reasoningEffort: e.target.value })}>{!settings.reasoningEffort && !defaultEffort(model) && <option value="">模型默认</option>}{modelEfforts(model).map(e => <option key={e}>{e}</option>)}</select></label>
          <label>已有结果<select aria-label="缓存使用方式" value={force ? "force" : "reuse"} disabled={building} onChange={e => setForce(e.target.value === "force")}><option value="reuse">复用相同设置的结果</option><option value="force">重新分析</option></select></label>
        </div></details>
        {building ? <button disabled={busy} onClick={() => void perform(() => api(`/knowledge/${active.id}/cancel`, { method: "POST" }))}>暂停整理</button> : <button className="primary" disabled={busy || !targets.length} onClick={() => start()}>{scope === "all" ? "整理全部" : scope === "selected" ? `整理所选章节 (${targets.length})` : "整理本章"}</button>}
      </div></div>
      <div className="chapter-task-meta"><span>{scope === "current" && currentId ? chapterName(course, r.documents.find(d => d.id === currentId) || { id: currentId, name: "正在载入章节" }) + " · " : ""}{targetPages} 页 · {model?.displayName || "连接后选择模型"} · {settings.reasoningEffort || model?.defaultReasoningEffort || "默认强度"} · {force ? "重新分析" : "优先复用结果"}</span><button disabled={busy || building || !results.size} onClick={() => start(true)}>汇总已整理章节</button></div>
      {live && <div className="chapter-live" role="status"><span className={building ? "status-dot" : ""} /><span>{building ? live.phase === "framework" ? "正在建立课程框架" : live.phase === "overview" ? "正在汇总已整理章节" : live.phase === "chapter" ? "正在汇总本章" : "正在读取" : live.state === "paused" ? "已暂停" : live.state === "completed" ? "本次整理完成" : "本次整理有未完成内容"}{live.activeDocumentId ? ` · ${chapterName(course, r.documents.find(d => d.id === live.activeDocumentId) || { id: live.activeDocumentId, name: "来源已删除" })}` : ""}{building && live.activePages?.length ? ` · 正在阅读第 ${Math.min(...live.activePages)}–${Math.max(...live.activePages)} 页` : ""} · 已读 {live.completed}/{live.total} 页 · 未读 {Math.max(0, live.total - live.completed - live.failed)} 页{live.failed ? ` · 失败 ${live.failed} 页` : ""} · 复用 {live.reused || 0} 页</span>{!building && task && ["paused", "partial", "failed"].includes(task.state) && <button disabled={busy} onClick={() => { if (r.requireAI()) void perform(() => api(`/knowledge/${task.id}/resume`, { method: "POST", body: JSON.stringify({ retryFailed: task.state !== "paused" }) })); }}>{task.state === "paused" ? "继续整理" : "重试未完成内容"}</button>}</div>}
      {building && <progress className="overview-progress" max={Math.max(1, active.total)} value={active.completed} aria-label="已成功读取页数" />}
      {task?.error && <p className="turn-error">{task.error}</p>}
      {error && <p className="turn-error" role="alert">{error}</p>}
      {scope === "selected" && <p className="muted">在下面勾选要整理的章节。资料是否参与问答，仍在“资料”页管理。</p>}
    </section>
    {recent?.framework && <section className="overview-framework"><div className="section-title"><h2>课程初步框架</h2><span>目录与开头预览 · 不计入已读页数</span></div>{answer(recent.framework, sources(recent))}<ReadingSeedLabel seed={recent.baseCheckpoint} /></section>}
    <div className="view-tabs">{["章节目录", "课程汇总", "逐页要点", "阅读记录", "历史版本"].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
    <section className="overview-results" aria-label={tab}>
      {tab === "章节目录" && <>{courseSections(course).map(section => <section className="chapter-section" key={section.id}><h2>{section.name}</h2>{section.documentIds.map((id, i) => {
        const doc = r.documents.find(d => d.id === id); if (!doc) return null;
        const result = results.get(id), status = statuses.get(id), allowed = course.selectedDocumentIds.includes(id);
        const readingRevision = [...revisions].reverse().find(k => k.chapters.some(c => c.documentId === id && c.sessionId));
        const readingResult = readingRevision?.chapters.find(c => c.documentId === id);
        const resumable = readingRevision && ["paused", "partial", "failed"].includes(readingRevision.state);
        return <div className="chapter-row" key={id}>{scope === "selected" && <input type="checkbox" aria-label={`整理章节 ${chapterName(course, doc)}`} checked={selected.includes(id)} disabled={!allowed || building} onChange={e => setSelected(s => e.target.checked ? [...new Set([...s, id])] : s.filter(x => x !== id))} />}<span className="chapter-number">{String(i + 1).padStart(2, "0")}</span><details className="chapter-content"><summary><strong>{chapterName(course, doc)}</strong><small>{doc.pages} 页 · {chapterStateLabels[status?.state || (result ? "completed" : "queued")]}{status?.completed !== undefined && status.state !== "queued" ? ` · ${status.completed}/${status.total || doc.pages} 页` : ""}{status?.failed ? ` · 失败 ${status.failed}` : ""}{!allowed ? " · 未用于问答" : ""}</small></summary>{result ? <>{answer(result.chapter.summary, sources(result.revision))}<p className="muted chapter-result-meta">{result.revision.settings.model || "历史模型"} · {result.chapter.summaryCompleted ?? result.chapter.completed ?? 0}/{doc.pages} 页 · {new Date(result.chapter.updatedAt || result.revision.createdAt).toLocaleString("zh-CN")}</p></> : <p className="muted">还没有本章摘要。你可以先阅读原文，或单独整理本章。</p>}<div className="page-actions">{readingResult?.sessionId && <button onClick={() => { setRecordId(readingResult.sessionId!); setTab("阅读记录"); }}>查看阅读记录</button>}<button disabled={!allowed || busy} onClick={() => void perform(async () => { await r.newConversation(id); r.navigateSource(doc.page, id); })}>基于本章提问</button>{!building && <button disabled={!allowed || busy} onClick={() => { if (r.requireAI()) void perform(() => resumable ? api(`/knowledge/${readingRevision.id}/resume`, { method: "POST", body: JSON.stringify({ retryFailed: true }) }) : api(`/courses/${course.id}/knowledge`, { method: "POST", body: JSON.stringify({ ...settings, force, documentIds: [id] }) })); }}>{resumable ? "继续原整理任务" : "整理本章"}</button>}</div><ReadingSeedLabel seed={readingResult?.checkpoint} />{status?.failed ? task?.pages.filter(p => p.documentId === id && p.state === "failed").map(p => <p key={p.page} className="turn-error">第 {p.page} 页：{p.error}</p>) : null}</details><button aria-label={`阅读 ${chapterName(course, doc)}`} onClick={() => r.navigateSource(doc.page, doc.id)}><Icon name="right" size={16} /></button></div>;
      })}</section>)}{!course.documentIds.length && <div className="workspace-empty"><p>添加课件后，章节目录会自动出现在这里。</p><button onClick={() => r.setWorkspaceView("materials")}>添加资料</button></div>}</>}
      {tab === "课程汇总" && (summaryRevision ? <><div className="coverage-note">本次汇总覆盖 {(summaryRevision.checkpoint?.completed ?? summaryRevision.chapters.reduce((n, c) => n + (c.summaryCompleted ?? c.completed ?? 0), 0))}/{summaryRevision.checkpoint?.total ?? summaryRevision.total} 页{summaryStale ? " · 章节或来源已有变化，可重新汇总" : ""}</div>{answer(summaryRevision.summary, sources(summaryRevision))}</> : <div className="workspace-empty"><p>先整理至少一章，再把已整理内容串联起来。</p><button disabled={busy || building || !results.size} onClick={() => start(true)}>汇总已整理章节</button></div>)}
      {tab === "逐页要点" && <>{recent?.pages.length ? recent.pages.map(p => <details key={p.documentId + p.page}><summary>{r.documents.find(d => d.id === p.documentId)?.name || "来源已删除"} · 第 {p.page} 页{p.state === "failed" ? " · 失败" : ""}</summary>{p.error ? <p className="turn-error">{p.error}</p> : answer(p.summary || "", new Map(p.sources.map(s => [s.id, s])))}</details>) : <p className="muted">本次任务尚无页面要点；旧内容可以在历史版本中查看。</p>}</>}
      {tab === "阅读记录" && <><select aria-label="阅读会话" value={recordId} onChange={e => setRecordId(e.target.value)}><option value="">选择课程或章节会话</option>{[...new Map(revisions.flatMap(k => [...(k.courseSessionId ? [{ id: k.courseSessionId, title: "课程总览" }] : []), ...k.chapters.filter(c => c.sessionId).map(c => ({ id: c.sessionId!, title: r.documents.find(d => d.id === c.documentId)?.name || "历史章节" }))]).map(s => [s.id, s])).values()].map(s => <option key={s.id} value={s.id}>{s.title} · {s.id.slice(0, 6)}</option>)}</select>{record && record.id === recordId ? <><ReadingSeedLabel seed={record.checkpoint} />{record.parent && <p className="muted">阅读起点：{record.parent.title} · 已读 {record.parent.completed}/{record.parent.total} 页</p>}{record.turns.map((t, i) => <details key={t.id}><summary>第 {i + 1} 轮 · {t.pages.length ? `第 ${Math.min(...t.pages)}–${Math.max(...t.pages)} 页` : t.key === "chapter" ? "章节成果" : t.key === "framework" ? "课程框架" : t.key.startsWith("preview:") ? "开头预览" : "课程更新"} · {t.state === "completed" ? "已完成" : t.state === "failed" ? "未完成" : "处理中"}</summary>{t.error && <p className="turn-error">{t.error}</p>}{answer(t.answer, new Map(record.turns.flatMap(x => x.sources).map(x => [x.id, x])))}</details>)}</> : <p className="muted">选择一个会话查看连续阅读过程。旧版逐页结果仍保留在历史版本中。</p>}</>}
      {tab === "历史版本" && <>{revisions.length ? <><select aria-label="历史整理版本" value={historyRevision?.id || ""} onChange={e => setHistory(e.target.value)}>{[...revisions].reverse().map(k => <option key={k.id} value={k.id}>{new Date(k.createdAt).toLocaleString("zh-CN")} · {k.documentIds.length} 章 · {k.settings.model || "历史模型"}</option>)}</select>{historyRevision && <><p className="muted">保留的历史结果。来源变更后不会自动重新分析。</p>{historyRevision.summary && answer(historyRevision.summary, sources(historyRevision))}{historyRevision.chapters.filter(c => c.summary).map(c => <details key={c.documentId}><summary>{r.documents.find(d => d.id === c.documentId)?.name || "来源已删除"}</summary>{answer(c.summary, sources(historyRevision))}</details>)}</>}</> : <p className="muted">暂无历史整理。</p>}</>}
    </section>
    {!!notes.length && <section className="recent-notes"><div className="section-title"><h2>最近笔记</h2><span>{notes.length} 条</span></div>{notes.slice(0, 3).map(n => <button key={n.id} onClick={() => requestOpenNote(n.id)}><Icon name="edit" size={17} /><span><strong>{n.title}</strong><small>{plainPreview(n.text, 80)}</small></span><Icon name="right" size={16} /></button>)}</section>}
  </main>;
}
