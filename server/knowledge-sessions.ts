import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { AISettings, Course, KnowledgeReadSession, KnowledgeRevision, KnowledgePage, ReadingSeed, Source } from "../shared/types.ts";

export const READING_VERSION = "reading-v4";
export function sameSources(a: string[], b: string[]) { return a.length === b.length && [...a].sort().join() === [...b].sort().join(); }
export function readingHistory(store: Store, seed?: ReadingSeed): { prompt: string; answer: string; images: string[]; sources: Source[] }[] {
  if (!seed) return [];
  const session = store.get<KnowledgeReadSession>("knowledgeSession", seed.sessionId);
  if (!session) return [];
  return [...readingHistory(store, session.parent), ...session.turns.slice(0, seed.through).filter(t => t.state === "completed").map(t => ({ prompt: t.prompt, answer: t.answer, images: t.images, sources: t.sources }))];
}
export function readingBackground(store: Store, seed?: ReadingSeed) {
  const history = readingHistory(store, seed);
  return history.map(t => t.answer).join("\n\n");
}
export function restoreReadingProgress(store: Store, revision: KnowledgeRevision) {
  for (const chapter of revision.chapters) {
    const session = chapter.sessionId ? store.get<KnowledgeReadSession>("knowledgeSession", chapter.sessionId) : undefined;
    if (!session?.documentId) continue;
    const pages: KnowledgePage[] = session.completedPages.map(page => {
      const matching = session.turns.filter(t => t.state === "completed" && t.pages.includes(page));
      const summary = matching.map(t => {
        const parts = t.answer.split(/(?=^###\s*第\s*\d+\s*页)/m);
        return parts.find(p => new RegExp(`^###\\s*第\\s*${page}\\s*页`).test(p)) || `本批次阅读记录：\n${t.answer}`;
      }).join("\n");
      return { documentId: session.documentId!, page, state: "completed", summary, sources: matching.flatMap(t => t.sources.filter(s => s.page === page)) };
    });
    revision.pages = [...revision.pages.filter(p => p.documentId !== session.documentId || !session.completedPages.includes(p.page)), ...pages];
    chapter.completed = session.completedPages.length;
    chapter.failed = revision.pages.filter(p => p.documentId === session.documentId && p.state === "failed").length;
    chapter.checkpoint = structuredClone(session.checkpoint);
  }
  return revision;
}
export function resolveReadingSeed(store: Store, courseId: string | undefined, documentId: string): ReadingSeed | undefined {
  const course = courseId ? store.get<Course>("course", courseId) : undefined;
  if (!course || !course.selectedDocumentIds.includes(documentId)) return;
  const available = store.all<KnowledgeReadSession>("knowledgeSession").filter(s => s.courseId === course.id && s.checkpoint && sameSources(s.documentIds, course.selectedDocumentIds) && s.documentIds.every(d => !!store.document(d))).sort((a, b) => (a.checkpoint?.createdAt || a.createdAt).localeCompare(b.checkpoint?.createdAt || b.createdAt));
  const chapter = available.filter(s => s.documentId === documentId && s.completedPages.length).at(-1);
  return structuredClone((chapter || available.filter(s => !s.documentId).at(-1))?.checkpoint);
}
export function createReadingSession(store: Store, courseId: string, documentIds: string[], settings: AISettings, title: string, total: number, documentId?: string, parent?: ReadingSeed) {
  return store.put<KnowledgeReadSession>("knowledgeSession", { id: randomUUID(), courseId, documentId, documentIds: [...documentIds], settings: structuredClone(settings), title, total, parent: parent && structuredClone(parent), turns: [], completedPages: [], createdAt: new Date().toISOString() });
}
export function checkpoint(session: KnowledgeReadSession, mode: "fork" | "context", completed = session.completedPages.length): ReadingSeed {
  const last = session.turns.at(-1)!;
  return { createdAt: new Date().toISOString(), sessionId: session.id, through: session.turns.length, title: session.title, documentIds: [...session.documentIds], completed, total: session.total, connectionId: session.settings.connectionId || "codex", model: session.settings.model || "", threadId: session.threadId, turnId: last.runtimeTurnId, mode, compressed: session.compressed };
}
