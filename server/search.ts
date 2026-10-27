const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().normalize("NFKC");
  const words = [...segmenter.segment(normalized)]
    .filter((x) => x.isWordLike)
    .map((x) => x.segment);
  for (const part of normalized.match(/[\p{Script=Han}]+/gu) || [])
    for (let i = 0; i < part.length - 1; i++) words.push(part.slice(i, i + 2));
  return words;
}
export function search(
  pages: { page: number; text: string }[],
  query: string,
  limit = 6,
) {
  const docs = pages.map((p) => ({ ...p, tokens: tokenize(p.text) })),
    q = [...new Set(tokenize(query))];
  const avg =
    docs.reduce((s, p) => s + p.tokens.length, 0) / Math.max(1, docs.length) ||
    1;
  const df = new Map(
    q.map((w) => [w, docs.filter((d) => d.tokens.includes(w)).length]),
  );
  return docs
    .map((d) => {
      let score = 0;
      for (const w of q) {
        const f = d.tokens.filter((t) => t === w).length;
        if (f)
          score +=
            (Math.log(
              1 + (docs.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5),
            ) *
              f *
              2.2) /
            (f + 1.2 * (0.25 + (0.75 * d.tokens.length) / avg));
      }
      return { page: d.page, text: d.text, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, limit);
}
export function excerpt(text: string, query: string, max = 1800) {
  if (text.length <= max) return text;
  const terms = tokenize(query).filter((x) => x.length > 1);
  const hit =
    terms
      .map((t) => text.indexOf(t))
      .filter((x) => x >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 150);
  return (
    (start ? "…" : "") +
    text.slice(start, start + max) +
    (start + max < text.length ? "…" : "")
  );
}
