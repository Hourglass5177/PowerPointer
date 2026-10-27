import type { Course, Document } from "../shared/types.ts";

// A course remains selected even while its first document is still importing.
export function readingDocumentId(
  documents: Document[], courseId: string, course: Course | undefined, requested: string,
) {
  const available = courseId
    ? documents.filter((d) => course?.documentIds.includes(d.id))
    : documents;
  if (available.some((d) => d.id === requested)) return requested;
  if (courseId) return course?.documentIds.find((id) => available.some((d) => d.id === id)) || "";
  return available.find((d) => !d.hiddenRecent)?.id || available[0]?.id || "";
}
