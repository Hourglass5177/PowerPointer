import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { manualEntries, manualHref, parseManual, readManualRoute, searchManual } from "../shared/manual.ts";

const sources = manualEntries.map(entry => ({ entry, text: readFileSync(new URL(`../docs/manual/${entry.id}.md`, import.meta.url), "utf8") }));
const articles = sources.map(({ entry, text }) => parseManual(entry, text));

test("十章手册的目录、深链接与本地图片均有效", () => {
  assert.equal(articles.length, 10);
  for (const { entry, text } of sources) {
    const article = articles.find(a => a.id === entry.id)!;
    assert.ok(article.title && article.summary && article.sections.length >= 3);
    for (const section of article.sections) {
      assert.ok(section.text.length > 20);
      assert.deepEqual(readManualRoute(manualHref(article.id, section.id)), { articleId: article.id, sectionId: section.id });
    }
    for (const link of text.matchAll(/\]\((#\/manual[^)]*)\)/g)) {
      const route = readManualRoute(link[1]);
      assert.ok(route && !route.invalid, `${entry.id}: ${link[1]}`);
      const target = articles.find(a => a.id === route.articleId);
      assert.ok(target, `${entry.id}: missing article ${link[1]}`);
      if (route.sectionId) assert.ok(target.sections.some(s => s.id === route.sectionId), `${entry.id}: missing section ${link[1]}`);
    }
    for (const image of text.matchAll(/!\[([^\]]+)\]\((\/manual\/[^)]+)\)/g)) {
      assert.ok(image[1].length > 5, "图片需要说明");
      const file = path.resolve("public", "." + image[2]);
      assert.ok(file.startsWith(path.resolve("public/manual") + path.sep));
      const bytes = readFileSync(file);
      assert.equal(bytes.readUInt16BE(0), 0xffd8, "截图应为有效 JPEG");
      assert.ok(bytes.length > 1000, `真实界面配图为空：${image[2]}`);
    }
  }
});

test("手册搜索支持中文任务、英文缩写、全角输入和多个关键词", () => {
  assert.equal(searchManual(articles, "API")[0].article.id, "settings");
  assert.equal(searchManual(articles, "备份")[0].section?.id, "backup");
  assert.equal(searchManual(articles, "快捷键")[0].section?.id, "shortcuts");
  assert.deepEqual(searchManual(articles, "ｐｐｔ").map(h => h.article.id), searchManual(articles, "PPT").map(h => h.article.id));
  assert.ok(searchManual(articles, "自动保存 笔记").some(h => h.article.id === "notes" && h.section?.id === "save"));
  assert.ok(searchManual(articles, "学习背景").some(h => h.article.id === "settings" && h.section?.id === "memory"));
  assert.ok(searchManual(articles, "扫描").some(h => h.article.id === "help" && h.section?.id === "scanned"));
  for (const query of ["", "　", "？！", "绝不存在的关键词"])
    assert.deepEqual(searchManual(articles, query), []);
});

test("手册路由不接管其他锚点，失效地址不会被当成有效小节", () => {
  assert.equal(readManualRoute("#manual-main"), undefined);
  assert.equal(readManualRoute("#/manual-other"), undefined);
  assert.equal(readManualRoute(""), undefined);
  assert.deepEqual(readManualRoute("#/manual/start/open/extra"), { invalid: true });
  assert.deepEqual(readManualRoute("#/manual/%zz"), { invalid: true });
  assert.deepEqual(readManualRoute("#/manual"), { articleId: undefined, sectionId: undefined });
});
