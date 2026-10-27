import type { Course, Document, KnowledgeChapter, KnowledgeRevision, LearningNote } from "./types.ts";

export function chapterName(course: Course | undefined, doc: Pick<Document, "id" | "name">) {
  return course?.displayNames?.[doc.id] || doc.name.replace(/\.(pdf|pptx?)$/i, "").replace(/_+/g, " ");
}

export function courseSections(course: Course) {
  const used = new Set<string>();
  const sections = (course.groups || []).map(group => ({
    ...group,
    documentIds: course.documentIds.filter(id => group.documentIds.includes(id)).filter(id => {
      if (!course.documentIds.includes(id) || used.has(id)) return false;
      used.add(id);
      return true;
    }),
  }));
  const remaining = course.documentIds.filter(id => !used.has(id));
  if (remaining.length) sections.push({ id: "ungrouped", name: sections.length ? "其他章节" : "课程章节", documentIds: remaining });
  return sections;
}

export function chapterResults(revisions: KnowledgeRevision[], documentIds: string[]) {
  const results = new Map<string, { chapter: KnowledgeChapter; revision: KnowledgeRevision }>();
  for (const revision of [...revisions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    for (const chapter of revision.chapters)
      if (chapter.summary && documentIds.includes(chapter.documentId)) {
        const previous = results.get(chapter.documentId);
        if (!previous || (chapter.updatedAt || revision.createdAt) >= (previous.chapter.updatedAt || previous.revision.createdAt))
          results.set(chapter.documentId, { chapter, revision });
      }
  return results;
}

export function noteInDocument(note: LearningNote, documentId: string) {
  return note.documentId === documentId || note.anchor?.documentId === documentId || note.sources.some(s => s.documentId === documentId);
}

export function summaryNeedsRefresh(summary: KnowledgeRevision, results: ReturnType<typeof chapterResults>, documentIds: string[]) {
  if (summary.documentIds.some(id => !documentIds.includes(id)) || documentIds.some(id => !summary.documentIds.includes(id))) return true;
  return documentIds.some(id => {
    const current = results.get(id);
    if (!current) return false;
    const captured = summary.chapters.find(c => c.documentId === id);
    const coverage = (chapter: KnowledgeChapter, revision: KnowledgeRevision) => chapter.summaryCompleted ?? chapter.completed ?? revision.pages.filter(p => p.documentId === id && p.state === "completed").length;
    return !captured || captured.summary !== current.chapter.summary || coverage(captured, summary) !== coverage(current.chapter, current.revision);
  });
}

export const chapterStateLabels: Record<string, string> = {
  queued: "未整理", reading: "读取中", summarizing: "汇总中", completed: "已整理",
  partial: "部分失败", failed: "整理失败", paused: "已暂停",
};
