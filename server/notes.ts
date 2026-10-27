import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { ContextSnapshot, Course, LearningNote, ReadingSession, SelectionRef, Turn, Source } from "../shared/types.ts";
import { citedSources, sourceMap } from "../shared/chat.ts";
import { noteInDocument } from "../shared/learning.ts";

export interface NoteInput {
  id?: string; courseId?: string; documentId?: string;
  title?: string; text?: string; anchor?: SelectionRef;
  turnId?: string; originKind?: "turn" | "readingTurn";
}
export class NotesService {
  constructor(private store: Store, private notify: () => void) {}
  get(id: string) {
    const note = this.store.get<LearningNote>("note", id);
    if (!note) throw Error("笔记不存在");
    return note;
  }
  list(query: { courseId?: string; documentId?: string; q?: string; deleted?: boolean } = {}) {
    const q = query.q?.trim().toLocaleLowerCase();
    return this.store.all<LearningNote>("note").filter(n =>
      !!n.deletedAt === !!query.deleted &&
      (query.courseId ? n.courseId === query.courseId : !n.courseId) &&
      (!query.documentId || noteInDocument(n, query.documentId)) &&
      (!q || (n.title + "\n" + n.text).toLocaleLowerCase().includes(q)),
    ).sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }
  private save(note: LearningNote) {
    const revision = (this.store.get<{ id: string; version: number }>("meta", "notes")?.version || 0) + 1;
    this.store.transaction(() => {
      const previous = this.store.get<LearningNote>("note", note.id);
      if (previous) this.store.put("noteVersion", { ...previous, id: `${note.id}:${previous.version || 1}`, noteId: note.id });
      this.store.put("note", note);
      this.store.put("meta", { id: "notes", version: revision });
    });
    this.notify(); return note;
  }
  create(input: NoteInput, frozenImage?: string) {
    if (input.id) {
      const existing = this.store.get<LearningNote>("note", input.id);
      if (existing) {
        if (existing.courseId !== input.courseId || existing.documentId !== input.documentId) throw Error("此笔记请求已用于其他来源");
        return existing;
      }
    }
    const now = new Date().toISOString();
    let note: LearningNote;
    if (input.turnId) {
      const kind = input.originKind || (this.store.turn(input.turnId) ? "turn" : "readingTurn");
      const turn = this.store.get<Turn>(kind, input.turnId);
      if (!turn || turn.state !== "completed") throw Error("只能收藏已完成的回答");
      const courseId = kind === "turn" ? this.store.conversation(turn.conversationId)?.courseId : turn.snapshot.courseId;
      if (input.courseId && input.courseId !== courseId) throw Error("回答不属于当前课程");
      const originTurnId = turn.originTurnId || turn.id;
      const existing = this.store.all<LearningNote>("note").find(n => n.courseId === courseId && (n.originTurnId === originTurnId || n.id === originTurnId));
      if (existing) return existing.deletedAt ? this.restore(existing.id) : existing;
      const context = turn.snapshot.contextSnapshotId ? this.store.get<ContextSnapshot>("context", turn.snapshot.contextSnapshotId) : undefined;
      const history = [...(context?.turns || []), ...this.store.all<Turn>(kind).filter(t => t.conversationId === turn.conversationId)];
      const sources = citedSources(turn.answer, sourceMap(history));
      const session = turn.readingSessionId ? this.store.get<ReadingSession>("reading", turn.readingSessionId) : undefined;
      const anchor = session?.selection || turn.snapshot.selections?.[0] || {
        id: randomUUID(), kind: turn.snapshot.rect ? "rectangle" as const : "text" as const,
        documentId: turn.snapshot.documentId, documentName: this.store.document(turn.snapshot.documentId)?.name,
        page: turn.snapshot.page, rotation: turn.snapshot.rotation, rect: turn.snapshot.rect,
        text: turn.snapshot.selectedText,
      };
      note = { id: input.id || randomUUID(), courseId, documentId: turn.snapshot.documentId, title: turn.question.slice(0, 100), text: turn.answer, sources, anchor, originTurnId, originKind: kind, createdAt: now };
    } else {
      const documentId = input.anchor?.documentId || input.documentId;
      const course = input.courseId ? this.store.get<Course>("course", input.courseId) : undefined;
      if (input.courseId && !course) throw Error("课程不存在");
      if (!course && !documentId) throw Error("请先打开课件再记笔记");
      if (documentId && (!this.store.document(documentId) || (course && !course.documentIds.includes(documentId)))) throw Error("笔记来源不属于当前课程或已删除");
      if (input.documentId && input.anchor && input.documentId !== input.anchor.documentId) throw Error("笔记与选区来源不一致");
      const anchor = input.anchor ? structuredClone(input.anchor) : undefined;
      if (anchor) {
        if (anchor.page < 1 || anchor.page > this.store.document(anchor.documentId)!.pages) throw Error("笔记页码无效");
        anchor.documentName = this.store.document(anchor.documentId)!.name;
        // Only attach a stored selection image owned by this exact selection.
        const stored = this.store.get<SelectionRef>("selection", anchor.id);
        anchor.image = frozenImage || (stored?.documentId === anchor.documentId && stored.page === anchor.page ? stored.image : undefined);
      }
      note = { id: input.id || randomUUID(), courseId: input.courseId, documentId, title: input.title?.trim() || (anchor?.text.slice(0, 50) || "新笔记"), text: input.text ?? (anchor?.text ? `> ${anchor.text.replaceAll("\n", "\n> ")}\n\n` : ""), anchor, sources: anchor && anchor.kind !== "answer" ? [{ id: `note-${anchor.id}`, documentId: anchor.documentId, documentName: anchor.documentName, page: anchor.page, text: anchor.text, rect: anchor.rect, rects: anchor.rects, image: anchor.kind === "rectangle" }] : [], createdAt: now };
    }
    return this.save({ ...structuredClone(note), version: 1, updatedAt: now });
  }
  edit(id: string, patch: { title?: string; text?: string; version: number; sources?: Source[] }) {
    const note = this.get(id);
    if (note.deletedAt) throw Error("笔记已删除，请先恢复");
    if (patch.version !== (note.version || 1)) throw Object.assign(Error("笔记已有更新，本地草稿已保留。请重新载入或另存为新笔记。"), { status: 409, code: "NOTE_CONFLICT" });
    return this.save({ ...note, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.text !== undefined ? { text: patch.text } : {}), ...(patch.sources ? { sources: patch.sources } : {}), version: (note.version || 1) + 1, updatedAt: new Date().toISOString() });
  }
  remove(id: string) {
    const note = this.get(id);
    return note.deletedAt ? note : this.save({ ...note, deletedAt: new Date().toISOString(), version: (note.version || 1) + 1 });
  }
  restore(id: string) {
    const note = this.get(id);
    return !note.deletedAt ? note : this.save({ ...note, deletedAt: undefined, version: (note.version || 1) + 1, updatedAt: new Date().toISOString() });
  }
}
