export type ManualEntry = { id: string; group: string; keywords: string };
export type ManualSection = { id: string; title: string; markdown: string; text: string };
export type ManualArticle = ManualEntry & { title: string; summary: string; sections: ManualSection[] };
export type ManualRoute = { articleId?: string; sectionId?: string; invalid?: boolean };

export const manualEntries: ManualEntry[] = [
  { id: "start", group: "开始阅读", keywords: "入门 上手 示例 第一次 启动" },
  { id: "materials", group: "开始阅读", keywords: "导入 PDF PPT PPTX 文件夹 课程 章节 分组 删除 同步" },
  { id: "reading", group: "开始阅读", keywords: "阅读 搜索 定位 翻页 缩放 框选 选字 快捷键 布局" },
  { id: "questions", group: "理解与整理", keywords: "提问 问答 解释 来源 范围 全文检索 追问 附图" },
  { id: "notes", group: "理解与整理", keywords: "笔记 记录 摘录 收藏 自动保存 复习 恢复" },
  { id: "overview", group: "理解与整理", keywords: "总览 整理 章节 汇总 总结 暂停 重试" },
  { id: "history", group: "理解与整理", keywords: "历史 会话 对话 归档 分支 重新回答 导出" },
  { id: "research", group: "深入使用", keywords: "研究 成果 报告 对比 核查 提纲 题目 版本" },
  { id: "settings", group: "深入使用", keywords: "连接 设置 API Codex ChatGPT 本地模型 助手 记忆 用量 MCP 联网" },
  { id: "help", group: "深入使用", keywords: "常见问题 故障 失败 扫描件 OCR 备份 迁移 数据 隐私" },
];

export function manualHref(articleId?: string, sectionId?: string) {
  return "#/manual" + (articleId ? `/${articleId}` : "") + (articleId && sectionId ? `/${sectionId}` : "");
}

export function readManualRoute(hash: string): ManualRoute | undefined {
  if (!/^#\/manual(?:\/|$)/.test(hash)) return;
  const match = /^#\/manual(?:\/([a-z0-9-]+))?(?:\/([a-z0-9-]+))?\/?$/.exec(hash);
  return match ? { articleId: match[1], sectionId: match[2] } : { invalid: true };
}

export function manualText(markdown: string) {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<!--.*?-->/g, "")
    .replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
}

export function parseManual(entry: ManualEntry, source: string): ManualArticle {
  const text = source.replaceAll("\r\n", "\n").trim();
  const title = /^# (.+)$/m.exec(text)?.[1];
  const headings = [...text.matchAll(/^## (.+?)\s*<!-- ([a-z0-9-]+) -->\s*$/gm)];
  if (!title || !headings.length) throw Error(`手册文章缺少标题或小节：${entry.id}`);
  const sections = headings.map((heading, i) => {
    const markdown = text.slice(heading.index! + heading[0].length, headings[i + 1]?.index ?? text.length).trim();
    return { id: heading[2], title: heading[1], markdown, text: manualText(markdown) };
  });
  if (new Set(sections.map(s => s.id)).size !== sections.length) throw Error(`手册小节 ID 重复：${entry.id}`);
  const summary = manualText(text.slice(text.indexOf("\n") + 1, headings[0].index));
  return { ...entry, title, summary, sections };
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export type ManualHit = { article: ManualArticle; section?: ManualSection; excerpt: string; score: number };

export function searchManual(articles: ManualArticle[], query: string): ManualHit[] {
  const terms = query.trim().split(/\s+/).map(normalize).filter(Boolean);
  if (!terms.length) return [];
  const hits: ManualHit[] = [];
  for (const article of articles) {
    const title = normalize(article.title), keywords = normalize(article.keywords);
    const whole = normalize([article.title, article.keywords, article.summary, ...article.sections.map(s => s.title + s.text)].join(" "));
    if (!terms.every(term => whole.includes(term))) continue;
    let section: ManualSection | undefined, best = 0;
    for (const candidate of article.sections) {
      const heading = normalize(candidate.title), body = normalize(candidate.text);
      const score = terms.reduce((n, term) => n + (heading.includes(term) || body.includes(term) ? 20 : 0)
        + (heading.includes(term) ? 12 : 0) + (body.includes(term) ? 2 : 0), 0);
      if (score > best) { best = score; section = candidate; }
    }
    const score = best + terms.reduce((n, term) => n + (title.includes(term) ? 50 : keywords.includes(term) ? 18 : 0), 0);
    const body = section?.text || article.summary;
    const firstMatch = query.trim().split(/\s+/).map(term => body.toLowerCase().indexOf(term.toLowerCase())).filter(n => n >= 0);
    const start = firstMatch.length ? Math.max(0, Math.min(...firstMatch) - 25) : 0;
    hits.push({ article, section, score, excerpt: (start ? "…" : "") + body.slice(start, start + 120) + (body.length > start + 120 ? "…" : "") });
  }
  return hits.sort((a, b) => b.score - a.score);
}
