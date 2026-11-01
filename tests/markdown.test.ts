import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { answerMarkdown, plainPreview } from "../shared/markdown.ts";

test("真实中文回答中的引号和冒号粗体可渲染，代码及公式保留", () => {
  const input =
    "判断标准仍是**“递归返回后是否还有工作”**。**补充说明：**需要前提。";
  const html = renderToStaticMarkup(
    createElement(Markdown, { children: answerMarkdown(input) }),
  );
  assert.match(html, /<strong>“递归返回后是否还有工作”<\/strong>/);
  assert.match(html, /<strong>补充说明：<\/strong>/);
  assert.ok(!html.includes("**"));
  const code =
    '```js\nconst example = "是**“引号”**，\\\\(code\\\\)";\n```\n`**提示：**abc`';
  assert.equal(answerMarkdown(code), code);
  assert.equal(
    answerMarkdown("   ```c\n   return x;\n   ```\n复杂度 \\(O(n)\\)"),
    "   ```c\n   return x;\n   ```\n复杂度 $O(n)$",
  );
  assert.equal(
    answerMarkdown("复杂度 \\(O(n)\\)，\\[x+1\\]"),
    "复杂度 $O(n)$，\n$$\nx+1\n$$\n",
  );
});
test("粗体跨过行内代码时，中文标点两侧仍能正确闭合", () => {
  const input =
    "简记：**`let` 对外给出计算结果，`local` 对外保留声明。**这延续了静态作用域。";
  const html = renderToStaticMarkup(
    createElement(Markdown, { children: answerMarkdown(input) }),
  );
  assert.match(html, /<strong><code>let<\/code>/);
  assert.ok(!html.includes("**"));
  assert.equal(answerMarkdown("`**代码：**不改`"), "`**代码：**不改`");
});

test("笔记预览去掉 Markdown 标记和内部引用，保留可读文字", () => {
  const text = "## 标题\n\n这是**重点**，引用 [课件 · 第1页](source:6b2a9e7e-p1) 和 [外链](https://a.com)。\n\n行内 $f'(x)=2x$\n\n$$\nx^2\n$$\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n\n- 项目 `code`\n> 引文";
  const preview = plainPreview(text);
  assert.equal(preview, "标题 这是重点，引用 课件 · 第1页 和 外链。 行内 f'(x)=2x x^2 列A 列B 1 2 const a = 1; 项目 code 引文");
  assert.ok(!preview.includes("source:"));
  assert.equal(plainPreview("一二三四五", 3), "一二三…");
});
