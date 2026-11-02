import type { ReadingSeed } from "../shared/types.ts";
export function ReadingSeedLabel({ seed }: { seed?: ReadingSeed }) {
  if (!seed) return null;
  return <div className="reading-context-label reading-seed-label">继承自 {seed.title} · 已读 {seed.completed}/{seed.total} 页 · {seed.mode === "context" ? "继承上下文" : "阅读分支"}{seed.compressed ? " · 含压缩记忆" : ""}</div>;
}
