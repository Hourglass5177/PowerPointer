import { randomUUID } from "node:crypto";
import type { ResearchArtifact, ArtifactVersion } from "../shared/ai.ts";
import type { Source } from "../shared/types.ts";
import { citedSources } from "../shared/chat.ts";
import { Store } from "./store.ts";

export function missingCitations(text: string, sources: Source[]) {
  const actual = new Set(sources.map(s => s.id));
  return [...new Set([...text.matchAll(/\]\(source:([^\s)]+)\)/g)].map(m => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }).filter(id => !actual.has(id)))];
}
export class ArtifactStore {
  constructor(readonly store: Store, readonly notify: () => void) {}
  list(courseId?: string, documentId?: string, deleted = false) { return this.store.all<ResearchArtifact>("aiArtifact").filter(a => a.courseId === courseId && (!documentId || a.documentId === documentId) && !!a.deletedAt === deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string) { const a = this.store.get<ResearchArtifact>("aiArtifact", id); if (!a) throw Error("研究成果不存在"); return a; }
  create(input: { id?: string; runId: string; courseId?: string; documentId: string; title: string; kind: ResearchArtifact["kind"]; text: string; sources: Source[] }) {
    const id = input.id || randomUUID(), previous = this.store.get<ResearchArtifact>("aiArtifact", id);
    if (previous) { if (previous.runId !== input.runId) throw Error("成果标识已被使用"); return previous; }
    const now = new Date().toISOString();
    const result = this.store.put<ResearchArtifact>("aiArtifact", { ...input, id, version: 1, createdAt: now, updatedAt: now }); this.notify(); return result;
  }
  edit(id: string, input: { title?: string; text?: string; version: number; sources?: Source[] }) {
    const old = this.get(id);
    if (old.deletedAt) throw Error("成果已移入回收站，请先恢复");
    if (old.version !== input.version) throw Object.assign(Error("成果已有新版本，当前草稿已保留。请重新载入或另存副本。"), { status: 409, code: "ARTIFACT_CONFLICT" });
    const updated = { ...old, title: input.title ?? old.title, text: input.text ?? old.text, sources: input.sources || old.sources, version: old.version + 1, updatedAt: new Date().toISOString() };
    this.store.transaction(() => { this.store.put<ArtifactVersion>("aiArtifactVersion", { ...old, id: `${id}:${old.version}`, artifactId: id }); this.store.put("aiArtifact", updated); }); this.notify(); return updated;
  }
  versions(id: string) { const current = this.get(id); return [...this.store.all<ArtifactVersion>("aiArtifactVersion").filter(v => v.artifactId === id), { ...current, id: `${id}:${current.version}`, artifactId: id }].sort((a, b) => b.version - a.version); }
  revert(id: string, version: number, expectedVersion: number) { const old = this.versions(id).find(v => v.version === version); if (!old) throw Error("历史版本不存在"); return this.edit(id, { title: old.title, text: old.text, sources: old.sources, version: expectedVersion }); }
  remove(id: string, restore = false) {
    const old = this.get(id); if (!!old.deletedAt === !restore) return old;
    const next = { ...old, deletedAt: restore ? undefined : new Date().toISOString(), updatedAt: new Date().toISOString(), version: old.version + 1 };
    this.store.transaction(() => { this.store.put<ArtifactVersion>("aiArtifactVersion", { ...old, id: `${id}:${old.version}`, artifactId: id }); this.store.put("aiArtifact", next); }); this.notify(); return next;
  }
  cited(text: string, sources: Source[]) { return citedSources(text, new Map(sources.map(s => [s.id, s]))); }
}
