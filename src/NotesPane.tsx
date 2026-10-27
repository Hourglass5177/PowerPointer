import { useEffect, useRef, useState } from "react";
import type { LearningNote, Rect } from "../shared/types.ts";
import { noteInDocument } from "../shared/learning.ts";
import type { NotesController } from "./useNotes.ts";
import type { Reader } from "./useReader.ts";
import { RichAnswer } from "./RichAnswer.tsx";
import { Icon } from "./controls.tsx";
import { api, renderUrl } from "./api.ts";

type Draft = { title: string; text: string; version: number };
function NoteEditor({ note, notes: n, r, onNavigate }: { note: LearningNote; notes: NotesController; r: Reader; onNavigate: () => void }) {
  const key = "pointer-note-draft-" + note.id;
  const initial = () => {
    try { const local = JSON.parse(localStorage.getItem(key) || "null"); if (local && typeof local.title === "string" && typeof local.text === "string") return local as Draft; } catch {}
    return { title: note.title, text: note.text, version: note.version || 1 };
  };
  const [draft, setDraft] = useState<Draft>(initial), [preview, setPreview] = useState(false);
  const [status, setStatus] = useState("已保存"), [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [versions, setVersions] = useState<LearningNote[]>([]), [version, setVersion] = useState(0);
  const latest = useRef(draft), saving = useRef(false), saved = useRef({ title: note.title, text: note.text, version: note.version || 1 });
  const mounted = useRef(true), saveNow = useRef<() => Promise<void>>(async () => {});
  const dirty = (d: Draft) => d.title !== saved.current.title || d.text !== saved.current.text;
  latest.current = draft;
  const change = (patch: Partial<Draft>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next; localStorage.setItem(key, JSON.stringify(next)); setDraft(next);
    if (!conflict) { setError(""); setStatus("待保存"); }
  };
  saveNow.current = async () => {
    if (saving.current || !dirty(latest.current) || conflict || note.deletedAt) return;
    saving.current = true;
    const submitted = { ...latest.current };
    if (mounted.current) { setStatus("保存中…"); setError(""); }
    try {
      const result = await n.save(note.id, submitted);
      saved.current = { title: result.title, text: result.text, version: result.version || 1 };
      const current = { ...latest.current, version: result.version || 1 };
      latest.current = current;
      if (dirty(current)) localStorage.setItem(key, JSON.stringify(current)); else localStorage.removeItem(key);
      if (mounted.current) { setDraft(current); setStatus(dirty(current) ? "待保存" : "已保存"); }
    } catch (e: any) {
      localStorage.setItem(key, JSON.stringify(latest.current));
      if (mounted.current) { setStatus("草稿保存在本机"); setError(e.message); setConflict(e.status === 409); }
    } finally { saving.current = false; }
  };
  useEffect(() => {
    if (note.deletedAt || conflict || !dirty(draft)) return;
    setStatus("待保存");
    const timer = setTimeout(() => void saveNow.current(), 500);
    return () => clearTimeout(timer);
  }, [draft, retry, conflict, note.deletedAt]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void saveNow.current(); }; }, []);
  const navigate = (page: number, documentId?: string, rect?: Rect, rects?: Rect[]) => {
    r.navigateSource(page, documentId, rect, rects); onNavigate();
  };
  const available = (documentId?: string) => !!documentId && r.documents.some(d => d.id === documentId);
  return <section className="note-editor" aria-label="编辑笔记">
    <div className="note-editor-heading">
      <button onClick={() => n.setSelected("")} aria-label="返回笔记列表"><Icon name="left" size={16} />笔记</button>
      <span className="note-save-status" role="status">{note.deletedAt ? "已删除" : status}</span>
      {note.deletedAt ? <button onClick={() => r.guard(() => n.restore(note.id))}>恢复</button> : <button aria-label="删除笔记" title="删除后可恢复" onClick={() => r.guard(async () => { await saveNow.current(); await n.remove(note.id); })}><Icon name="trash" size={16} /></button>}
    </div>
    <input className="note-title" aria-label="笔记标题" value={draft.title} maxLength={200} disabled={!!note.deletedAt} onChange={e => change({ title: e.target.value })} placeholder="笔记标题" />
    <div className="note-mode-switch"><button aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</button><button aria-pressed={preview} onClick={() => setPreview(true)}>预览</button><button onClick={() => r.guard(async () => { await saveNow.current(); setVersions(await api<LearningNote[]>(`/notes/${note.id}/versions`)); setVersion(saved.current.version); })}>版本记录</button><span>Markdown · 公式 · 代码</span></div>
    {version > 0 && <div className="note-version-history"><select aria-label="笔记历史版本" value={version} onChange={e => setVersion(Number(e.target.value))}>{versions.map(v => <option key={v.version || 1} value={v.version || 1}>第 {v.version || 1} 版 · {new Date(v.updatedAt || v.createdAt).toLocaleString()}</option>)}</select><div className="answer answer-v2"><RichAnswer text={versions.find(v => (v.version || 1) === version)?.text || ""} sources={new Map((versions.find(v => (v.version || 1) === version)?.sources || []).map(s => [s.id, s]))} navigate={navigate} /></div><button disabled={!!note.deletedAt || conflict || dirty(draft) || version === saved.current.version} onClick={() => r.guard(async () => { const result = await api<LearningNote>(`/notes/${note.id}/revert`, { method: "POST", body: JSON.stringify({ version, expectedVersion: saved.current.version }) }); const next = { title: result.title, text: result.text, version: result.version || 1 }; saved.current = next; latest.current = next; setDraft(next); localStorage.removeItem(key); setVersion(0); setStatus("已恢复历史版本"); await n.reload(); })}>恢复此版本</button><button onClick={() => setVersion(0)}>关闭</button></div>}
    {error && <div className="note-save-error" role="alert"><p>{error}</p>{!conflict && <button onClick={() => { setError(""); setRetry(retry + 1); }}>重试保存</button>}{conflict && <>
      <button onClick={() => r.guard(async () => { const current = await api<LearningNote[]>(`/notes?${note.courseId ? "courseId=" + note.courseId : "documentId=" + note.documentId}`); const remote = current.find(x => x.id === note.id); if (!remote) throw Error("笔记已删除，请先恢复"); const next = { title: remote.title, text: remote.text, version: remote.version || 1 }; saved.current = next; latest.current = next; setDraft(next); localStorage.removeItem(key); setConflict(false); setError(""); setStatus("已重新载入"); })}>载入最新版本</button>
      <button onClick={() => r.guard(async () => { await n.create({ title: draft.title + " · 副本", text: draft.text, anchor: note.anchor && available(note.anchor.documentId) ? note.anchor : undefined }); localStorage.removeItem(key); })}>另存草稿</button>
    </>}</div>}
    {preview ? <div className="note-preview answer answer-v2"><RichAnswer text={draft.text || "*还没有正文。*"} sources={new Map(note.sources.map(s => [s.id, s]))} navigate={navigate} /></div> : <textarea aria-label="笔记正文" className="note-body" placeholder="写下你的理解…" value={draft.text} maxLength={200000} disabled={!!note.deletedAt} onChange={e => change({ text: e.target.value })} />}
    <div className="note-provenance">
      <h3>{note.anchor?.kind === "answer" ? "AI 回答摘录 · 原讨论页" : note.originTurnId ? "收藏回答的来源" : "来源"}</h3>
      {note.anchor && <>
        <button className="note-source-link" disabled={!available(note.anchor.documentId)} onClick={() => { r.navigateSource(note.anchor!.page, note.anchor!.documentId, note.anchor!.rect, note.anchor!.rects); onNavigate(); }}>
          <Icon name="file" size={15} />{note.anchor.documentName || "课件"} · 第 {note.anchor.page} 页{!available(note.anchor.documentId) ? " · 来源已删除" : " ↗"}
        </button>
        {!!note.anchor.text && <blockquote>{note.anchor.text}</blockquote>}
        {note.anchor.kind === "rectangle" && (note.anchor.image || available(note.anchor.documentId)) && <img className="note-crop" src={note.anchor.image ? `/api/attachments/${note.anchor.image}` : renderUrl(note.anchor.documentId, note.anchor.page, note.anchor.rotation, note.anchor.rect, true)} alt="收藏的框选区域" />}
      </>}
      {note.sources.filter(s => !note.anchor || s.documentId !== note.anchor.documentId || s.page !== note.anchor.page).map(s => <button key={s.id} className="note-source-link" disabled={!available(s.documentId)} onClick={() => { r.navigateSource(s.page, s.documentId, s.rect, s.rects); onNavigate(); }}>{s.documentName || "课件"} · 第 {s.page} 页{!available(s.documentId) ? " · 来源已删除" : " ↗"}</button>)}
      {!note.anchor && !note.sources.length && <p>{note.documentId ? `${r.documents.find(d => d.id === note.documentId)?.name || "来源已删除"} · 手写笔记` : "课程手写笔记"}</p>}
      <small>创建于 {new Date(note.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
    </div>
  </section>;
}
export function NotesPane({ notes: n, r, onNavigate }: { notes: NotesController; r: Reader; onNavigate: () => void }) {
  const selected = n.notes.find(x => x.id === n.selected);
  const list = n.notes.filter(x => (n.allChapters || noteInDocument(x, r.docId)) && (!n.query || (x.title + "\n" + x.text).toLocaleLowerCase().includes(n.query.toLocaleLowerCase())));
  return <section className="notes-pane" aria-label="学习笔记">
    {n.undo && <div className="note-undo" role="status">已删除笔记<button onClick={() => r.guard(() => n.restore(n.undo!.id))}>撤销</button></div>}
    {selected ? <NoteEditor key={selected.id} note={selected} notes={n} r={r} onNavigate={onNavigate} /> : <>
      <div className="notes-toolbar"><select aria-label="笔记范围" value={n.allChapters ? "all" : "chapter"} onChange={e => n.setAllChapters(e.target.value === "all")}><option value="chapter">本章笔记</option>{r.course && <option value="all">全课程笔记</option>}</select><button className="primary" onClick={() => r.guard(() => n.create())}><Icon name="plus" size={15} />新笔记</button><details className="popover"><summary aria-label="笔记更多操作"><Icon name="more" size={18} /></summary><div className="popover-panel"><button onClick={() => n.setDeleted(!n.deleted)}>{n.deleted ? "返回笔记" : "已删除笔记"}</button></div></details></div>
      <label className="notes-search"><Icon name="search" size={16} /><input aria-label="搜索笔记" placeholder="搜索标题或正文" value={n.query} onChange={e => n.setQuery(e.target.value)} /></label>
      {n.deleted && <p className="muted notes-caption">已删除笔记 · 打开后可恢复</p>}
      {n.error && <p className="turn-error" role="alert">{n.error}<button onClick={() => r.guard(n.reload)}>重试</button></p>}
      <div className="notes-list">{list.map(note => <button className="note-list-item" key={note.id} onClick={() => n.setSelected(note.id)}><strong>{note.title || "无标题笔记"}</strong><p>{note.text.replace(/[#>*`]/g, "").slice(0, 100) || "开始记录你的理解"}</p><small>{note.anchor ? `第 ${note.anchor.page} 页 · ` : ""}{note.originTurnId ? "AI 回答收藏" : "阅读笔记"}{note.documentId && !r.documents.some(d => d.id === note.documentId) ? " · 来源已删除" : ""}</small></button>)}
      {!list.length && <div className="notes-empty"><Icon name="edit" size={26} /><h3>{n.loading ? "正在载入笔记…" : n.query ? "没有匹配的笔记" : n.deleted ? "暂无已删除笔记" : "把理解留在这一页"}</h3><p>{n.query ? "试试其他关键词。" : "选一段文字、框选图表，或收藏回答。也可以直接写一条笔记。"}</p>{!n.query && !n.deleted && <button onClick={() => r.guard(() => n.create())}>写第一条笔记</button>}</div>}</div>
    </>}
  </section>;
}
