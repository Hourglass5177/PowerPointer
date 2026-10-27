import type { Store } from "./store.ts";
import type { Course, KnowledgeRevision, KnowledgeSnapshot, LearningNote } from "../shared/types.ts";
import { chapterName, chapterResults, noteInDocument } from "../shared/learning.ts";
import { citedSources } from "../shared/chat.ts";

export function captureKnowledge(store: Store, courseId: string | undefined, documentIds: string[]): KnowledgeSnapshot {
  const course = courseId ? store.get<Course>("course", courseId) : undefined;
  const allowed = documentIds.filter(id => !!store.document(id));
  const revisions = store.all<KnowledgeRevision>("knowledge").filter(r => r.courseId === courseId && !!courseId);
  const results = chapterResults(revisions, allowed);
  const snapshot: KnowledgeSnapshot = { capturedAt: new Date().toISOString(), summary: "", chapters: [], sources: [], completed: 0, total: allowed.reduce((n, id) => n + store.document(id)!.pages, 0) };
  for (const id of allowed) {
    const result = results.get(id);
    if (!result) continue;
    const { chapter, revision } = result;
    const pages = revision.pages.filter(p => p.documentId === id && p.state === "completed");
    snapshot.completed += chapter.summaryCompleted ?? chapter.completed ?? pages.length;
    snapshot.chapters.push({ documentId: id, title: chapterName(course, store.document(id)!), summary: chapter.summary });
    snapshot.sources.push(...(chapter.sources || pages.flatMap(p => p.sources)));
  }
  const summary = revisions.filter(r => r.summary && r.documentIds.every(id => allowed.includes(id))).sort((a, b) => (a.summaryUpdatedAt || a.createdAt).localeCompare(b.summaryUpdatedAt || b.createdAt)).at(-1);
  if (summary) {
    snapshot.summary = summary.summary;
    snapshot.sources.push(...summary.pages.flatMap(p => p.sources), ...summary.chapters.flatMap(c => c.sources || []));
  }
  const text = snapshot.summary + snapshot.chapters.map(c => c.summary).join("\n");
  snapshot.sources = citedSources(text, new Map(snapshot.sources.filter(s => allowed.includes(s.documentId) && !s.deleted).map(s => [s.id, { ...s, text: s.text.slice(0, 1000) }])));
  return snapshot;
}

export function captureNotes(store: Store, courseId: string | undefined, documentIds: string[]) {
  return store.all<LearningNote>("note").filter(n => !n.deletedAt && (courseId ? n.courseId === courseId : !n.courseId && documentIds.some(id => noteInDocument(n, id))) && (!n.documentId || documentIds.includes(n.documentId)) && n.sources.every(s => documentIds.includes(s.documentId) && !s.deleted)).slice(-8);
}

export function knowledgeText(snapshot: KnowledgeSnapshot | undefined) {
  if (!snapshot || (!snapshot.summary && !snapshot.chapters.length)) return "";
  return JSON.stringify({ note: "已整理部分的 AI 摘要，非原文；未整理内容不代表已经阅读。", coverage: `${snapshot.completed}/${snapshot.total} 页`, summary: snapshot.summary, chapters: snapshot.chapters });
}
