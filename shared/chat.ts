import type { Source, Turn } from "./types.ts";

export function sourceMap(turns: Turn[], documentId?: string) {
  return new Map(
    turns
      .flatMap((t) => [...t.snapshot.sources, ...(t.toolSources || [])])
      .filter((s) => !documentId || s.documentId === documentId)
      .map((s) => [s.id, s]),
  );
}
export function citedSources(answer: string, sources: Map<string, Source>) {
  const ids = [...answer.matchAll(/\[[^\]]*\]\(source:([^\s)]+)\)/g)].map(
    (m) => m[1],
  );
  return [...new Set(ids)]
    .map((id) => sources.get(id))
    .filter((s): s is Source => !!s);
}
export function portableAnswer(
  answer: string,
  sources: Map<string, Source>,
  name: string,
) {
  return answer.replace(
    /\[([^\]]*)\]\(source:([^\s)]+)\)/g,
    (_m, label, id) => {
      const s = sources.get(id);
      return s
        ? `${label}（${s.documentName || name}，第 ${s.page} 页${s.deleted ? "，来源已删除" : ""}）`
        : label;
    },
  );
}
export function autoTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 26) || "新会话";
}
