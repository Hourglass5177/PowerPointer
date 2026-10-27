import { useEffect, useRef, useState } from "react";
import type { LearningNote, SelectionRef } from "../shared/types.ts";
import type { Reader } from "./useReader.ts";
import { api } from "./api.ts";
import { noteInDocument } from "../shared/learning.ts";

export function requestSaveAnswer(turnId: string, originKind: "turn" | "readingTurn") {
  window.dispatchEvent(new CustomEvent("pointer:save-answer", { detail: { turnId, originKind } }));
}
export function requestOpenNote(id: string) {
  window.dispatchEvent(new CustomEvent("pointer:open-note", { detail: id }));
}
export function useNotes(r: Reader, revision: number) {
  const [notes, setNotes] = useState<LearningNote[]>([]), [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false), [allChapters, setAllChapters] = useState(false), [query, setQuery] = useState("");
  const [undo, setUndo] = useState<LearningNote>();
  const scope = r.courseId || r.docId, activeScope = useRef(scope);
  activeScope.current = scope;
  const reload = async () => {
    const list = await api<LearningNote[]>(`/notes?${r.courseId ? "courseId=" + r.courseId : "documentId=" + r.docId}&deleted=${deleted}`);
    if (activeScope.current === scope) setNotes(list);
  };
  useEffect(() => { setSelected(""); setUndo(undefined); setQuery(""); setAllChapters(false); setDeleted(false); }, [scope]);
  useEffect(() => {
    if (!r.ready || !scope) { setNotes([]); return; }
    let disposed = false;
    setLoading(true);
    api<LearningNote[]>(`/notes?${r.courseId ? "courseId=" + r.courseId : "documentId=" + r.docId}&deleted=${deleted}`)
      .then(list => { if (!disposed) { setNotes(list); setError(""); } })
      .catch(e => !disposed && setError(e.message)).finally(() => !disposed && setLoading(false));
    return () => { disposed = true; };
  }, [r.ready, scope, deleted, revision]);
  const receive = (note: LearningNote) => {
    if (activeScope.current !== scope) return;
    setNotes(ns => [note, ...ns.filter(n => n.id !== note.id)]);
    return note;
  };
  const open = (id: string) => { setSelected(id); setDeleted(false); };
  const create = async (input: { title?: string; text?: string; anchor?: SelectionRef; turnId?: string; originKind?: "turn" | "readingTurn" } = {}) => {
    const note = await api<LearningNote>("/notes", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), ...(input.turnId ? {} : { courseId: r.courseId || undefined, documentId: r.docId || undefined, anchor: input.anchor || (r.doc ? { id: crypto.randomUUID(), kind: "text", documentId: r.doc.id, documentName: r.doc.name, page: r.doc.page, rotation: r.doc.rotation, text: "" } : undefined) }), ...input }) });
    if (receive(note)) { setDeleted(false); setSelected(note.id); }
    return note;
  };
  const save = async (id: string, draft: { title: string; text: string; version: number }) => {
    const note = await api<LearningNote>("/notes/" + id, { method: "PATCH", body: JSON.stringify(draft) });
    receive(note); return note;
  };
  const remove = async (id: string) => {
    const note = await api<LearningNote>("/notes/" + id, { method: "DELETE" });
    if (activeScope.current !== scope) return;
    setNotes(ns => ns.filter(n => n.id !== id)); setSelected(""); setUndo(note);
  };
  const restore = async (id: string) => {
    const note = await api<LearningNote>("/notes/" + id + "/restore", { method: "POST" });
    if (receive(note)) { setDeleted(false); setUndo(undefined); setSelected(note.id); }
  };
  const inScope = (note: LearningNote) => r.courseId ? note.courseId === r.courseId : !note.courseId && noteInDocument(note, r.docId);
  return { notes: notes.filter(inScope), selected, open, setSelected, loading, error, deleted, setDeleted, allChapters, setAllChapters, query, setQuery, undo: undo && inScope(undo) ? undo : undefined, create, save, remove, restore, reload };
}
export type NotesController = ReturnType<typeof useNotes>;
