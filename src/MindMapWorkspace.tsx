import { useEffect, useMemo, useRef, useState } from "react";
import { panViewportUpdate, zoomViewport, type MindMapPan } from "./mindMapViewport.ts";
import type { Reader } from "./useReader.ts";
import type { AISettings, Document, MindMap, MindMapNode, MindMapScope } from "../shared/types.ts";
import {
  MIND_MAP_COLORS,
  MIND_MAP_NODE_HEIGHT,
  MIND_MAP_NODE_WIDTH,
  layoutMindMap,
  mindMapBounds,
  mindMapChildren,
  mindMapDescendants,
  validateMindMapNodes,
  visibleMindMapNodes,
  type MindMapPosition,
} from "../shared/mind-map.ts";
import { api } from "./api.ts";
import { Icon, Tool } from "./controls.tsx";
import { ModelSelect, ProfileButtons } from "./AIControls.tsx";
import { exportMindMapJson, exportMindMapPng, exportMindMapSvg, exportMindMapMarkdown } from "./mindMapExport.ts";

type SaveState = "saved" | "dirty" | "saving" | "error";
type Target = { scope: MindMapScope; courseId?: string; documentId?: string };
// Keep saves ordered when the workspace unmounts and is opened again immediately.
const persistenceQueue = { current: Promise.resolve() as Promise<unknown> };

function CommitInput({ value, onCommit, ariaLabel, className }: { value: string; onCommit: (value: string) => void; ariaLabel: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return <input className={className} aria-label={ariaLabel} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
    if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); }
    else if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); }
  }} />;
}

function InlineNodeEditor({ node, onCommit, onClose }: { node: MindMapNode; onCommit: (text: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(node.text), cancelled = useRef(false);
  const commit = () => {
    if (!cancelled.current && value.trim() && value.trim() !== node.text) onCommit(value.trim());
    onClose();
  };
  return <input autoFocus className="mind-map-inline-input" aria-label="编辑节点标题" value={value} onChange={event => setValue(event.target.value)} onBlur={commit} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    else if (event.key === "Escape") { cancelled.current = true; onClose(); }
  }} />;
}

function NodeInspector({ node, root, documents, childCount, nodes, onMove, onReorder, onPatch, onAddChild, onAddSibling, onDuplicate, onRemove, onNavigate }: {
  node: MindMapNode; root: boolean; documents: Document[]; childCount: number;
  nodes: MindMapNode[]; onMove: (parentId: string) => void; onReorder: (direction: -1 | 1) => void;
  onPatch: (patch: Partial<MindMapNode>) => void; onAddChild: () => void; onAddSibling: () => void;
  onDuplicate: () => void; onRemove: () => void; onNavigate: () => void;
}) {
  const [text, setText] = useState(node.text), [note, setNote] = useState(node.note || ""), [link, setLink] = useState(node.link || ""), [page, setPage] = useState(String(node.source?.page || 1));
  useEffect(() => { setText(node.text); setNote(node.note || ""); setLink(node.link || ""); setPage(String(node.source?.page || 1)); }, [node.id, node.text, node.note, node.link, node.source?.page]);
  const currentDocument = documents.find(document => document.id === node.source?.documentId);
  const descendants = mindMapDescendants(nodes, node.id);
  return <aside className="mind-map-inspector" aria-label="节点属性">
    <div className="mind-map-inspector-heading"><strong>{root ? "中心主题" : "节点"}</strong><small>{childCount} 个子节点</small></div>
    <label>标题<textarea rows={2} value={text} maxLength={160} onChange={event => setText(event.target.value)} onBlur={() => {
      const value = text.trim(); if (value && value !== node.text) onPatch({ text: value }); else setText(node.text);
    }} /></label>
    <label>备注<textarea rows={5} value={note} maxLength={4000} onChange={event => setNote(event.target.value)} onBlur={() => {
      const value = note.trim(); if (value !== (node.note || "")) onPatch({ note: value || undefined });
    }} /></label>
    <fieldset className="mind-map-colors"><legend>分支颜色</legend>{MIND_MAP_COLORS.map(color => <button key={color} type="button" title={color} aria-label={`使用颜色 ${color}`} aria-pressed={(node.color || MIND_MAP_COLORS[0]) === color} style={{ background: color }} onClick={() => onPatch({ color })} />)}</fieldset>
    {!root && <label>父节点<select value={node.parentId} onChange={event => onMove(event.target.value)}>{nodes.filter(item => !descendants.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.text}</option>)}</select></label>}
    {!root && <div className="mind-map-order"><button onClick={() => onReorder(-1)} title="分支上移">↑</button><button onClick={() => onReorder(1)} title="分支下移">↓</button><select aria-label="分支方向" value={node.side || "right"} onChange={event => onPatch({ side: event.target.value as "left" | "right" })}><option value="left">左侧</option><option value="right">右侧</option></select></div>}
    <label>来源课件<select value={node.source?.documentId || ""} onChange={event => {
      const document = documents.find(item => item.id === event.target.value);
      onPatch({ source: document ? { documentId: document.id, documentName: document.name, page: Math.min(node.source?.page || 1, document.pages) } : undefined });
    }}><option value="">无来源</option>{documents.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
    {node.source && !currentDocument && <p className="turn-error">来源课件已移除：{node.source.documentName || "原课件"}</p>}
    {currentDocument && <div className="mind-map-source-row"><label>页码<input type="number" min={1} max={currentDocument.pages} value={page} onChange={event => setPage(event.target.value)} onBlur={() => {
      const value = Math.max(1, Math.min(currentDocument.pages, Number(page) || 1)); setPage(String(value));
      if (value !== node.source?.page) onPatch({ source: { ...node.source!, page: value } });
    }} /></label><button onClick={onNavigate}>查看来源</button></div>}
    <label>网页链接<input value={link} placeholder="https://" onChange={event => setLink(event.target.value)} onBlur={() => {
      const value = link.trim(); if (value && !/^https?:\/\//i.test(value)) { setLink(node.link || ""); return; }
      if (value !== (node.link || "")) onPatch({ link: value || undefined });
    }} /></label>
    {node.link && <button className="mind-map-open-link" onClick={() => window.open(node.link, "_blank", "noopener,noreferrer")}>打开链接</button>}
    <div className="mind-map-node-actions">
      <button onClick={onAddChild}><Icon name="plus" size={15} />子节点</button>
      <button disabled={root} onClick={onAddSibling}><Icon name="branch" size={15} />同级节点</button>
      <button disabled={root} onClick={onDuplicate}><Icon name="copy" size={15} />复制分支</button>
      <button className="danger" disabled={root} onClick={onRemove}><Icon name="trash" size={15} />删除分支</button>
    </div>
  </aside>;
}

export function MindMapWorkspace({ r }: { r: Reader }) {
  const [scope, setScope] = useState<MindMapScope>(r.courseId ? "course" : "document");
  const [maps, setMaps] = useState<MindMap[]>([]), [map, setMap] = useState<MindMap>();
  const mapRef = useRef<MindMap | undefined>(undefined);
  const [selectedId, setSelectedId] = useState(""), [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(false), [generating, setGenerating] = useState(false);
  const [error, setError] = useState(""), [saveState, setSaveState] = useState<SaveState>("saved");
  const [query, setQuery] = useState(""), [focus, setFocus] = useState(""), [settings, setSettings] = useState<AISettings>({});
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const stage = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const past = useRef<MindMap[]>([]), future = useRef<MindMap[]>([]);
  const serverVersions = useRef(new Map<string, number>()), editVersions = useRef(new Map<string, number>()), dirty = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), saveQueue = persistenceQueue;
  const pan = useRef<MindMapPan | undefined>(undefined);
  const drag = useRef<{ pointerId: number; id: string; clientX: number; clientY: number; origin: MindMapPosition; before: MindMap; base: MindMap } | undefined>(undefined);
  const latestSave = useRef<(map: MindMap) => Promise<unknown>>(async () => {});
  const [outline, setOutline] = useState(false);
  const generationController = useRef<AbortController | undefined>(undefined);
  const fitLatest = useRef<() => void>(() => {});

  useEffect(() => {
    if (r.ai.config && !settings.connectionId && !settings.model) setSettings(r.ai.config.preferences.profiles.batch || {});
  }, [r.ai.config]);
  useEffect(() => { if (r.ready && scope === "course" && !r.course) setScope("document"); }, [scope, r.course?.id, r.ready]);

  const target: Target | undefined = scope === "course"
    ? r.course ? { scope, courseId: r.course.id } : undefined
    : r.doc ? { scope, courseId: r.course?.documentIds.includes(r.doc.id) ? r.course.id : undefined, documentId: r.doc.id } : undefined;
  const targetKey = target ? `${target.scope}:${target.courseId || ""}:${target.documentId || ""}` : "none";
  const activeTarget = useRef(targetKey);
  activeTarget.current = targetKey;
  const targetDocuments = target?.scope === "course"
    ? r.documents.filter(document => r.course?.documentIds.includes(document.id))
    : r.doc ? [r.doc] : [];

  const setActiveMap = (next: MindMap | undefined, resetHistory = true) => {
    mapRef.current = next; setMap(next); setSelectedId(next?.rootId || ""); setEditingId("");
    if (next) serverVersions.current.set(next.id, next.version);
    if (resetHistory) { past.current = []; future.current = []; }
    setSaveState(next && dirty.current.has(next.id) ? "dirty" : "saved");
  };

  useEffect(() => {
    let disposed = false;
    const previous = mapRef.current;
    const pending = previous && dirty.current.has(previous.id) ? saveSnapshot(previous) : saveQueue.current;
    clearTimeout(saveTimer.current);
    generationController.current?.abort();
    setActiveMap(undefined);
    setMaps([]);
    if (!target) { setMaps([]); setActiveMap(undefined); return; }
    setLoading(true); setError("");
    const params = new URLSearchParams(Object.entries(target).filter(([, value]) => value) as [string, string][]);
    pending.catch(() => {}).then(() => api<MindMap[]>(`/mind-maps?${params}`)).then(list => {
      if (disposed) return;
      const restored = list.map(item => {
        try {
          const draft = JSON.parse(localStorage.getItem(`pointer-mind-map-${item.id}`) || "null") as MindMap | null;
          if (draft) {
            validateMindMapNodes(draft.nodes, draft.rootId);
            dirty.current.add(item.id);
            if (draft.version !== item.version) setError("本机保留了未保存的导图，服务端也有更新。请先导出 JSON 保留修改，再重新载入。 ");
            return draft;
          }
        } catch { /* Invalid browser drafts do not replace the server record. */ }
        return item;
      });
      setMaps(restored); for (const item of list) serverVersions.current.set(item.id, item.version);
      setActiveMap(restored[0]);
    }).catch(cause => !disposed && setError(cause.message)).finally(() => !disposed && setLoading(false));
    return () => { disposed = true; };
  }, [targetKey]);

  const saveSnapshot = (snapshot: MindMap) => {
    clearTimeout(saveTimer.current);
    const editVersion = editVersions.current.get(snapshot.id) || 0;
    const job = saveQueue.current.catch(() => {}).then(async () => {
      if (mapRef.current?.id === snapshot.id) setSaveState("saving");
      const saved = await api<MindMap>(`/mind-maps/${snapshot.id}`, { method: "PUT", body: JSON.stringify({
        expectedVersion: serverVersions.current.get(snapshot.id) || snapshot.version,
        title: snapshot.title, rootId: snapshot.rootId, nodes: snapshot.nodes, layout: snapshot.layout, theme: snapshot.theme,
      }) });
      serverVersions.current.set(saved.id, saved.version);
      const unchanged = (editVersions.current.get(saved.id) || 0) === editVersion;
      setMaps(items => items.map(item => item.id === saved.id ? unchanged ? saved : { ...item, version: saved.version, updatedAt: saved.updatedAt } : item));
      if (unchanged) { dirty.current.delete(saved.id); localStorage.removeItem(`pointer-mind-map-${saved.id}`); }
      if (mapRef.current?.id === saved.id) {
        const next = { ...mapRef.current, version: saved.version, updatedAt: saved.updatedAt };
        mapRef.current = next; setMap(next);
        if (unchanged) { setSaveState("saved"); }
        else setSaveState("dirty");
      }
      return saved;
    }).catch(cause => {
      if (mapRef.current?.id === snapshot.id) { setSaveState("error"); setError(cause.message); }
      throw cause;
    });
    saveQueue.current = job;
    return job;
  };

  const markDirty = (next: MindMap) => {
    editVersions.current.set(next.id, (editVersions.current.get(next.id) || 0) + 1);
    dirty.current.add(next.id); setSaveState("dirty");
    try { localStorage.setItem(`pointer-mind-map-${next.id}`, JSON.stringify(next)); }
    catch { setError("浏览器草稿空间不足，请等待服务器保存后再离开。"); }
    setMaps(items => items.map(item => item.id === next.id ? next : item));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveSnapshot(next).catch(() => {}), 700);
  };
  const commit = (update: (current: MindMap) => MindMap) => {
    const current = mapRef.current; if (!current || generating) return;
    const next = update(current); if (next === current) return;
    try { validateMindMapNodes(next.nodes, next.rootId); }
    catch (cause) { setError((cause as Error).message); return; }
    past.current = [...past.current.slice(-79), current]; future.current = [];
    mapRef.current = next; setMap(next); markDirty(next);
  };
  const replaceAfterHistory = (next: MindMap) => {
    const current = mapRef.current; if (!current) return;
    mapRef.current = { ...next, version: current.version }; setMap(mapRef.current); markDirty(mapRef.current);
    if (!next.nodes.some(node => node.id === selectedId)) setSelectedId(next.rootId);
  };
  const undo = () => { const current = mapRef.current, previous = past.current.pop(); if (!current || !previous) return; future.current.push(current); replaceAfterHistory(previous); };
  const redo = () => { const current = mapRef.current, next = future.current.pop(); if (!current || !next) return; past.current.push(current); replaceAfterHistory(next); };

  latestSave.current = saveSnapshot;
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (mapRef.current && dirty.current.has(mapRef.current.id)) { event.preventDefault(); }
    };
    window.addEventListener("beforeunload", leaving);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      clearTimeout(saveTimer.current);
      generationController.current?.abort();
      const current = mapRef.current;
      if (current && dirty.current.has(current.id)) void latestSave.current(current).catch(() => {});
    };
  }, []);

  const autoPositions = useMemo(() => map ? layoutMindMap(map.nodes, map.rootId) : new Map<string, MindMapPosition>(), [map?.nodes, map?.rootId]);
  const positions = useMemo(() => {
    if (!map || map.layout === "tree") return autoPositions;
    const result = new Map<string, MindMapPosition>();
    for (const node of visibleMindMapNodes(map.nodes, map.rootId)) {
      const fallback = autoPositions.get(node.id);
      result.set(node.id, { x: Number.isFinite(node.x) ? node.x! : fallback?.x || 0, y: Number.isFinite(node.y) ? node.y! : fallback?.y || 0 });
    }
    return result;
  }, [map?.nodes, map?.rootId, map?.layout, autoPositions]);
  const visibleNodes = useMemo(() => map ? visibleMindMapNodes(map.nodes, map.rootId) : [], [map?.nodes, map?.rootId]);
  const selected = map?.nodes.find(node => node.id === selectedId);
  const matches = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return value && map ? map.nodes.filter(node => `${node.text}\n${node.note || ""}`.toLocaleLowerCase().includes(value)) : [];
  }, [map?.nodes, query]);

  const fitView = () => {
    const element = stage.current; if (!element || !positions.size) return;
    const bounds = mindMapBounds(positions), rect = element.getBoundingClientRect();
    const zoom = Math.max(0.2, Math.min(1.25, (rect.width - 100) / Math.max(bounds.width, 1), (rect.height - 100) / Math.max(bounds.height, 1)));
    setViewport({ zoom, x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom });
  };
  fitLatest.current = fitView;
  useEffect(() => {
    if (!map?.id || !stage.current) return;
    const observer = new ResizeObserver(() => fitLatest.current());
    observer.observe(stage.current);
    requestAnimationFrame(() => fitLatest.current());
    return () => observer.disconnect();
  }, [map?.id, map?.rootId]);
  const focusNode = (id: string) => {
    let position = positions.get(id);
    if (!position && map) {
      const ancestors = new Set<string>();
      let parent = map.nodes.find(node => node.id === id)?.parentId;
      while (parent) { ancestors.add(parent); parent = map.nodes.find(node => node.id === parent)?.parentId; }
      const expanded = map.nodes.map(node => ancestors.has(node.id) ? { ...node, collapsed: false } : node);
      position = layoutMindMap(expanded, map.rootId).get(id);
      commit(current => ({ ...current, nodes: expanded }));
    }
    const element = stage.current; if (!position || !element) return;
    const rect = element.getBoundingClientRect();
    setViewport(current => ({ ...current, x: rect.width / 2 - (position.x + MIND_MAP_NODE_WIDTH / 2) * current.zoom, y: rect.height / 2 - (position.y + MIND_MAP_NODE_HEIGHT / 2) * current.zoom }));
    setSelectedId(id);
  };

  const updateNode = (id: string, patch: Partial<MindMapNode>) => commit(current => ({ ...current, nodes: current.nodes.map(node => node.id === id ? { ...node, ...patch } : node) }));
  const addNode = (nodeId: string, sibling = false) => {
    const current = mapRef.current, selectedNode = current?.nodes.find(node => node.id === nodeId); if (!current || !selectedNode) return;
    const actualParent = sibling ? selectedNode.parentId : selectedNode.id; if (!actualParent) return;
    const parent = current.nodes.find(node => node.id === actualParent)!, siblings = mindMapChildren(current.nodes, actualParent), id = crypto.randomUUID();
    const node: MindMapNode = { id, parentId: actualParent, text: "新主题", color: selectedNode.color || MIND_MAP_COLORS[0], side: parent.id === current.rootId ? siblings.length % 2 ? "left" : "right" : selectedNode.side };
    if (current.nodes.length >= 300) { setError("每份导图最多 300 个节点，请拆分为多份导图。"); return; }
    commit(value => ({ ...value, nodes: [...value.nodes.map(item => item.id === actualParent ? { ...item, collapsed: false } : item), node] })); setSelectedId(id); setEditingId(id);
  };
  const removeNode = (id: string) => {
    const current = mapRef.current; if (!current || id === current.rootId) return;
    const removed = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const node of current.nodes) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) { removed.add(node.id); changed = true; } }
    const parentId = current.nodes.find(node => node.id === id)?.parentId;
    commit(value => ({ ...value, nodes: value.nodes.filter(node => !removed.has(node.id)) })); setSelectedId(parentId || current.rootId);
  };
  const duplicateNode = (id: string) => {
    const current = mapRef.current, source = current?.nodes.find(node => node.id === id); if (!current || !source || id === current.rootId) return;
    const subtree = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const node of current.nodes) if (node.parentId && subtree.has(node.parentId) && !subtree.has(node.id)) { subtree.add(node.id); changed = true; } }
    const ids = new Map([...subtree].map(old => [old, crypto.randomUUID()]));
    const clones = current.nodes.filter(node => subtree.has(node.id)).map(node => ({ ...node, id: ids.get(node.id)!, parentId: node.id === id ? source.parentId : node.parentId ? ids.get(node.parentId) : undefined, text: node.id === id ? `${node.text} 副本` : node.text, x: node.x === undefined ? undefined : node.x + 28, y: node.y === undefined ? undefined : node.y + 28 }));
    commit(value => ({ ...value, nodes: [...value.nodes, ...clones] })); setSelectedId(ids.get(id)!);
  };
  const collapseAll = (collapsed: boolean) => commit(current => ({ ...current, nodes: current.nodes.map(node => ({ ...node, collapsed: node.id === current.rootId ? false : mindMapChildren(current.nodes, node.id).length ? collapsed : node.collapsed })) }));
  const moveNode = (id: string, parentId: string) => commit(current => ({
    ...current, layout: "tree", nodes: current.nodes.map(node => node.id === id ? { ...node, parentId } : node.id === parentId ? { ...node, collapsed: false } : node),
  }));
  const reorderNode = (id: string, direction: -1 | 1) => commit(current => {
    const node = current.nodes.find(item => item.id === id);
    if (!node?.parentId) return current;
    const siblings = mindMapChildren(current.nodes, node.parentId), index = siblings.findIndex(item => item.id === id), other = siblings[index + direction];
    if (!other) return current;
    const nodes = [...current.nodes], from = nodes.findIndex(item => item.id === id), to = nodes.findIndex(item => item.id === other.id);
    [nodes[from], nodes[to]] = [nodes[to], nodes[from]];
    return { ...current, layout: "tree", nodes };
  });

  const createMap = async () => {
    if (!target) return;
    if (mapRef.current && dirty.current.has(mapRef.current.id)) await saveSnapshot(mapRef.current);
    setError("");
    const created = await api<MindMap>("/mind-maps", { method: "POST", body: JSON.stringify(target) });
    if (activeTarget.current !== targetKey) return;
    setMaps(items => [created, ...items]); setActiveMap(created); requestAnimationFrame(fitView);
  };
  const chooseMap = async (next: MindMap) => {
    const current = mapRef.current;
    if (current && current.id !== next.id && dirty.current.has(current.id))
      await saveSnapshot(current);
    setActiveMap(next);
  };
  const reloadMap = async () => {
    if (!target || !window.confirm("重新载入会放弃这份导图尚未保存的本机修改。请先导出 JSON 保留需要的内容。继续吗？")) return;
    clearTimeout(saveTimer.current);
    await saveQueue.current.catch(() => {});
    const current = mapRef.current;
    const params = new URLSearchParams(Object.entries(target).filter(([, value]) => value) as [string, string][]);
    const list = await api<MindMap[]>(`/mind-maps?${params}`);
    if (current) { dirty.current.delete(current.id); localStorage.removeItem(`pointer-mind-map-${current.id}`); }
    setMaps(list); setActiveMap(list.find(item => item.id === current?.id) || list[0]); setError("");
  };
  const generate = async () => {
    if (!target || !r.requireAI()) return;
    const current = mapRef.current;
    if (current && current.nodes.length > 1 && !window.confirm("AI 初稿会替换当前节点，但仍可使用撤销恢复。继续吗？")) return;
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true); setError("");
    try {
      if (current && dirty.current.has(current.id)) await saveSnapshot(current);
      const generated = await api<MindMap>("/mind-maps/generate", { method: "POST", signal: controller.signal, body: JSON.stringify({
        ...target, ...settings, mapId: current?.id,
        expectedVersion: current ? serverVersions.current.get(current.id) || current.version : undefined,
        focus: focus.trim() || undefined,
      }) });
      if (activeTarget.current !== targetKey) return;
      if (current) past.current.push(current); future.current = [];
      serverVersions.current.set(generated.id, generated.version); dirty.current.delete(generated.id); editVersions.current.set(generated.id, 0);
      localStorage.removeItem(`pointer-mind-map-${generated.id}`);
      setMaps(items => [generated, ...items.filter(item => item.id !== generated.id)]); setActiveMap(generated, false); requestAnimationFrame(fitView);
    } catch (cause) { setError(controller.signal.aborted ? "已停止生成，原导图已保留。" : (cause as Error).message); }
    finally { generationController.current = undefined; setGenerating(false); }
  };
  const deleteMap = async () => {
    const current = mapRef.current;
    if (!current || !window.confirm(`删除“${current.title}”？此操作不可撤销。`)) return;
    clearTimeout(saveTimer.current);
    await saveQueue.current.catch(() => {});
    await api(`/mind-maps/${current.id}`, { method: "DELETE" });
    dirty.current.delete(current.id); localStorage.removeItem(`pointer-mind-map-${current.id}`);
    const remaining = maps.filter(item => item.id !== current.id); setMaps(remaining); setActiveMap(remaining[0]);
  };
  const importMap = async (file: File) => {
    if (!target) return;
    try {
      if (file.size > 1000000) throw Error("导图文件超过 1 MB，请精简节点备注后重试");
      const input = JSON.parse(await file.text()) as Partial<MindMap>;
      if (!Array.isArray(input.nodes) || typeof input.rootId !== "string") throw Error("文件不是 Power Pointer 思维导图");
      validateMindMapNodes(input.nodes as MindMapNode[], input.rootId);
      if (mapRef.current && dirty.current.has(mapRef.current.id)) await saveSnapshot(mapRef.current);
      const validDocuments = new Set(targetDocuments.map(document => document.id)), idMap = new Map<string, string>();
      for (const node of input.nodes) idMap.set(node.id, crypto.randomUUID());
      const nodes = input.nodes.map(node => ({
        ...node, id: idMap.get(node.id)!, parentId: node.parentId ? idMap.get(node.parentId) : undefined,
        source: node.source && validDocuments.has(node.source.documentId) && node.source.page <= (targetDocuments.find(document => document.id === node.source!.documentId)?.pages || 0) ? node.source : undefined,
        link: node.link && /^https?:\/\//i.test(node.link) ? node.link : undefined,
      }));
      const saved = await api<MindMap>("/mind-maps", { method: "POST", body: JSON.stringify({
        ...target, title: input.title || file.name,
        imported: { rootId: idMap.get(input.rootId), nodes,
          layout: input.layout === "free" ? "free" : "tree",
          theme: ["paper", "colorful", "mono"].includes(input.theme || "") ? input.theme : "paper" },
      }) });
      if (activeTarget.current !== targetKey) return;
      setMaps(items => [saved, ...items]); setActiveMap(saved); requestAnimationFrame(fitView);
    } catch (cause) { setError((cause as Error).message); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (r.workspaceView !== "mindmap" || event.isComposing || event.keyCode === 229 || generating) return;
      const target = event.target as HTMLElement, typing = !!target.closest("input,textarea,select,[contenteditable=true]");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (mapRef.current) void saveSnapshot(mapRef.current).catch(() => {}); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { if (typing) return; event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { if (typing) return; event.preventDefault(); redo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); search.current?.focus(); return; }
      if (typing || !selectedId || (target.closest("button,summary") && !target.closest(".mind-map-outline"))) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeNode(selectedId); }
      else if (event.key === "Insert") { event.preventDefault(); addNode(selectedId); }
      else if (event.key === "Enter") { event.preventDefault(); addNode(selectedId, true); }
      else if (event.key === "F2") { event.preventDefault(); setEditingId(selectedId); }
      else if (event.key === "Tab" && target.closest(".mind-map-stage")) { event.preventDefault(); addNode(selectedId); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  });

  const edgePath = (node: MindMapNode) => {
    if (!node.parentId) return "";
    const child = positions.get(node.id), parent = positions.get(node.parentId); if (!child || !parent) return "";
    const right = child.x > parent.x, startX = parent.x + (right ? MIND_MAP_NODE_WIDTH : 0), startY = parent.y + MIND_MAP_NODE_HEIGHT / 2;
    const endX = child.x + (right ? 0 : MIND_MAP_NODE_WIDTH), endY = child.y + MIND_MAP_NODE_HEIGHT / 2, bend = (startX + endX) / 2;
    return `M ${startX} ${startY} C ${bend} ${startY}, ${bend} ${endY}, ${endX} ${endY}`;
  };
  const beginDrag = (event: React.PointerEvent, node: MindMapNode) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input")) return;
    const current = mapRef.current, origin = positions.get(node.id); if (!current || !origin || generating) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const base: MindMap = current.layout === "tree" ? { ...current, layout: "free", nodes: current.nodes.map(item => {
      const position = positions.get(item.id); return position ? { ...item, ...position } : item;
    }) } : current;
    drag.current = { pointerId: event.pointerId, id: node.id, clientX: event.clientX, clientY: event.clientY, origin, before: current, base };
  };
  const endPan = (event: React.PointerEvent) => {
    if (pan.current?.pointerId === event.pointerId) pan.current = undefined;
  };

  if (!target) return <main className="mind-map-workspace"><div className="workspace-empty"><h1>思维导图</h1><p>先打开一份课件，或创建包含课件的课程。</p><button onClick={() => r.setWorkspaceView("materials")}>打开资料</button></div></main>;

  return <main className={`mind-map-workspace ${generating ? "is-generating" : ""}`} aria-busy={loading || generating}>
    <header className="mind-map-toolbar" inert={generating ? true : undefined}>
      <div className="mind-map-scope" role="group" aria-label="导图范围">
        <button aria-pressed={scope === "course"} disabled={!r.course?.documentIds.length} onClick={() => setScope("course")}>整个课程</button>
        <button aria-pressed={scope === "document"} disabled={!r.doc} onClick={() => setScope("document")}>当前课件</button>
      </div>
      <select aria-label="选择思维导图" value={map?.id || ""} onChange={event => {
        const next = maps.find(item => item.id === event.target.value); if (next) void chooseMap(next).catch(cause => setError(cause.message));
      }}>
        {!maps.length && <option value="">暂无导图</option>}
        {maps.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <Tool icon="plus" title="新建空白导图" disabled={loading} onClick={() => void createMap().catch(cause => setError(cause.message))} />
      <details className="popover mind-map-ai-settings">
        <summary title="AI 生成设置" aria-label="AI 生成设置"><Icon name="settings" size={17} /></summary>
        <div className="popover-panel">
          <ProfileButtons ai={r.ai} onChange={setSettings} />
          <label>模型<ModelSelect models={r.models} value={settings} ai={r.ai} onChange={value => setSettings({ ...settings, ...value })} /></label>
          <label>生成重点<textarea rows={3} maxLength={500} value={focus} onChange={event => setFocus(event.target.value)} /></label>
        </div>
      </details>
      <button className="primary mind-map-generate" disabled={generating || loading || !targetDocuments.length} onClick={() => void generate()}><Icon name="map" size={16} />{generating ? "正在生成" : "AI 生成初稿"}</button>
      <span className={`mind-map-save-state ${saveState}`} role="status">{{ saved: "已保存", dirty: "待保存", saving: "保存中", error: "保存失败" }[saveState]}</span>
      <Tool icon="check" title="保存导图 (Ctrl+S)" disabled={!map} onClick={() => map && void saveSnapshot(map).catch(() => {})} />
      <button aria-pressed={outline} title="大纲视图" onClick={() => setOutline(!outline)}><Icon name="list" size={16} /></button>
      <div className="mind-map-spacer" />
      <input ref={search} className="mind-map-search" aria-label="搜索导图节点" placeholder="搜索节点" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && matches.length) { const current = matches.findIndex(node => node.id === selectedId); focusNode(matches[(current + 1) % matches.length].id); }
      }} />
      {query && <small>{matches.length}</small>}
      <Tool icon="undo" title="撤销 (Ctrl+Z)" disabled={!past.current.length} onClick={undo} />
      <Tool icon="redo" title="重做 (Ctrl+Y)" disabled={!future.current.length} onClick={redo} />
      <details className="popover">
        <summary aria-label="导入与导出" title="导入与导出"><Icon name="download" size={17} /></summary>
        <div className="popover-panel mind-map-export-menu">
          <button onClick={() => fileInput.current?.click()}>导入 JSON</button>
          <button disabled={!map} onClick={() => map && exportMindMapJson(map)}>导出 JSON</button>
          <button disabled={!map} onClick={() => map && exportMindMapMarkdown(map)}>导出 Markdown</button>
          <button disabled={!map} onClick={() => map && exportMindMapSvg(map, positions)}>导出 SVG</button>
          <button disabled={!map} onClick={() => map && void exportMindMapPng(map, positions).catch(cause => setError(cause.message))}>导出 PNG</button>
        </div>
      </details>
      <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void importMap(file); }} />
      <Tool icon="trash" title="删除当前导图" disabled={!map} onClick={() => void deleteMap().catch(cause => setError(cause.message))} />
    </header>
    {error && <div className="mind-map-error" role="alert"><span>{error}</span>{map && <button onClick={() => void reloadMap().catch(cause => setError(cause.message))}>重新载入</button>}<button aria-label="关闭错误" onClick={() => setError("")}>×</button></div>}
    {generating && <div className="mind-map-generating" role="status"><span>正在分析资料并生成初稿…</span><button onClick={() => generationController.current?.abort()}>停止生成</button></div>}
    {!map ? <div className="workspace-empty mind-map-empty">
      <Icon name="map" size={34} /><h1>{scope === "course" ? r.course?.name : r.doc?.name}</h1>
      <div><button onClick={() => void createMap().catch(cause => setError(cause.message))}>新建空白导图</button><button className="primary" disabled={generating} onClick={() => void generate()}>AI 生成初稿</button></div>
    </div> : <div className="mind-map-editor" inert={generating || loading ? true : undefined}>
      {outline && <aside className="mind-map-outline" aria-label="导图大纲">{visibleNodes.map(node => {
        let depth = 0, parent = node.parentId;
        while (parent) { depth++; parent = map.nodes.find(item => item.id === parent)?.parentId; }
        return <button key={node.id} aria-current={selectedId === node.id ? "true" : undefined} style={{ paddingLeft: 12 + depth * 12 }} onClick={() => focusNode(node.id)}>{node.text}</button>;
      })}</aside>}
      <section ref={stage} className={`mind-map-stage theme-${map.theme}`} aria-label="思维导图画布" tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0 || (event.target as HTMLElement).closest(".mind-map-node,button,input,select,textarea,summary,details")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pan.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y }; setSelectedId("");
        }}
        onPointerMove={event => {
          const update = panViewportUpdate(pan, event);
          if (update) setViewport(update);
        }}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        onWheel={event => {
          event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
          const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }, deltaY = event.deltaY;
          setViewport(current => zoomViewport(current, point, deltaY));
        }}>
        <div className="mind-map-canvas-tools">
          <Tool icon="center" title="适合画布" onClick={fitView} />
          <button title="缩小" onClick={() => setViewport(value => ({ ...value, zoom: Math.max(0.2, value.zoom - 0.1) }))}>−</button>
          <button className="mind-map-zoom-value" onClick={fitView}>{Math.round(viewport.zoom * 100)}%</button>
          <button title="放大" onClick={() => setViewport(value => ({ ...value, zoom: Math.min(2.5, value.zoom + 0.1) }))}>+</button>
          <button title="自动排版" onClick={() => commit(current => ({ ...current, layout: "tree" }))}><Icon name="retry" size={15} /></button>
          <button title="展开全部" onClick={() => collapseAll(false)}><Icon name="expand" size={15} /></button>
          <button title="折叠全部分支" onClick={() => collapseAll(true)}><Icon name="collapse" size={15} /></button>
        </div>
        <div className="mind-map-theme-control" role="group" aria-label="导图主题">
          {(["paper", "colorful", "mono"] as const).map(theme => <button key={theme} aria-pressed={map.theme === theme} title={{ paper: "纸张", colorful: "彩色", mono: "黑白" }[theme]} onClick={() => commit(current => ({ ...current, theme }))} />)}
        </div>
        <div className="mind-map-transform" role="tree" aria-label="导图节点" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          <svg className="mind-map-edges" aria-hidden="true">
            {visibleNodes.filter(node => node.parentId).map(node => <path key={node.id} d={edgePath(node)} style={{ stroke: map.theme === "mono" ? "#777" : node.color || MIND_MAP_COLORS[0] }} />)}
          </svg>
          {visibleNodes.map(node => {
            const position = positions.get(node.id); if (!position) return null;
            const children = mindMapChildren(map.nodes, node.id), root = node.id === map.rootId, hit = matches.some(match => match.id === node.id);
            return <article key={node.id}
              className={`mind-map-node ${root ? "root" : ""} ${selectedId === node.id ? "selected" : ""} ${hit ? "search-hit" : ""}`}
              role="treeitem" aria-selected={selectedId === node.id} tabIndex={selectedId === node.id ? 0 : -1}
              style={{ left: position.x, top: position.y, "--node-color": node.color || MIND_MAP_COLORS[0] } as React.CSSProperties}
              onClick={event => { event.stopPropagation(); setSelectedId(node.id); }}
              onDoubleClick={event => { event.stopPropagation(); setEditingId(node.id); }}
              onPointerDown={event => beginDrag(event, node)}
              onPointerMove={event => {
                const state = drag.current; if (!state || state.pointerId !== event.pointerId || state.id !== node.id) return;
                const dx = (event.clientX - state.clientX) / viewport.zoom, dy = (event.clientY - state.clientY) / viewport.zoom;
                if (Math.abs(dx) + Math.abs(dy) < 4) return;
                const descendants = mindMapDescendants(state.base.nodes, node.id);
                const next: MindMap = { ...state.base, nodes: state.base.nodes.map(item => descendants.has(item.id) ? { ...item, x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy } : item) };
                mapRef.current = next; setMap(next);
              }}
              onPointerUp={event => {
                const state = drag.current; if (!state || state.pointerId !== event.pointerId || state.id !== node.id) return;
                drag.current = undefined; const next = mapRef.current; if (!next || next === state.before) return;
                past.current = [...past.current.slice(-79), state.before]; future.current = []; markDirty(next);
              }}
              onPointerCancel={() => {
                const state = drag.current; if (!state || state.id !== node.id) return;
                drag.current = undefined; mapRef.current = state.before; setMap(state.before);
              }}>
              {editingId === node.id
                ? <InlineNodeEditor node={node} onCommit={text => updateNode(node.id, { text })} onClose={() => setEditingId("")} />
                : <span className="mind-map-node-title" title={node.text}>{node.text}</span>}
              <span className="mind-map-node-meta">{node.note && <i title="有备注" />}{node.source && <b>第 {node.source.page} 页</b>}</span>
              {!!children.length && <button className="mind-map-collapse" aria-label={node.collapsed ? "展开分支" : "折叠分支"} title={node.collapsed ? "展开分支" : "折叠分支"}
                onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); updateNode(node.id, { collapsed: !node.collapsed }); }}>
                {node.collapsed ? children.length : "−"}
              </button>}
            </article>;
          })}
        </div>
      </section>
      {selected ? <NodeInspector key={selected.id} node={selected} root={selected.id === map.rootId} documents={targetDocuments}
        nodes={map.nodes} onMove={parentId => moveNode(selected.id, parentId)} onReorder={direction => reorderNode(selected.id, direction)}
        childCount={mindMapChildren(map.nodes, selected.id).length} onPatch={patch => updateNode(selected.id, patch)}
        onAddChild={() => addNode(selected.id)} onAddSibling={() => addNode(selected.id, true)} onDuplicate={() => duplicateNode(selected.id)}
        onRemove={() => removeNode(selected.id)} onNavigate={() => selected.source && r.navigateSource(selected.source.page, selected.source.documentId)} />
        : <aside className="mind-map-inspector map-settings" aria-label="导图属性">
          <div className="mind-map-inspector-heading"><strong>导图</strong><small>{map.nodes.length} 个节点</small></div>
          <label>名称<CommitInput ariaLabel="导图名称" value={map.title} onCommit={title => commit(current => ({ ...current, title }))} /></label>
          <button onClick={() => setSelectedId(map.rootId)}>选择中心主题</button>
        </aside>}
    </div>}
  </main>;
}
