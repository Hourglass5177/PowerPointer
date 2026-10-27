import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { answerMarkdown } from "../shared/markdown.ts";

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
