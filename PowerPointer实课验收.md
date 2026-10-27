# PowerPointer 实课验收

2026-10-13，使用已导入的 `0Lecture 1-lg-0320.pptx`，共 90 页，其中 83 页有可检索文字。全部五轮问题从浏览器界面发送，使用真实 ChatGPT 订阅模型，无模拟回答。测试会话为「PowerPointer 实课验收 · 函数式编程」，可在应用内继续查看。

## 真实问题与质量核对

| 问题 | 实际模型与强度 | 核对结果 |
|---|---|---|
| 第 51 页：什么是尾递归，C 求和为何不算 | GPT-6.1-Sol / low | 正确识别返回后待完成的加法，累加器例子结果 42；明确常量栈需要实际尾调用优化。 |
| 追问第 54 页：比较两个 ML sum，用 [3,4,5] 展开 | GPT-6-Luna / medium | 两个版本均得 12；继承前一轮的优化前提，引用第 49、51、52、54 页。发送保留首轮追问关联，但页面改为 54。 |
| 第 48 页：“不能处理 I/O”是否适用于 SML | GPT-6-Luna / medium，联网开启 | 实际执行搜索与打开 TextIO 文档，指出纯函数与现实语言能力的区别；同时引用课件第 29 页的 I/O 机制，给出可用的 TextIO.print 例子。 |
| 第 84、87 页：eval、decimal 是否互逆，是否尾递归 | GPT-6.1-Sol / medium，联网关闭 | 实际读取两页文字与 PNG。正确算出 eval [2,4] = 42、decimal 42 = [2,4]；检查空列表、0、[2,4,0]，说明规范表示限制；两个函数都不是尾递归。 |
| 第 75 页：框选 pi / area，翻至 76 页后发送 | GPT-6-Luna / low，课件工具与联网关闭 | 快照仍为第 75 页，包含整页和裁图。正确解释静态作用域下 area 保留原 pi 绑定，并识别结果中 3,14 的逗号排印错误；回答符合三句话以内要求。 |

联网回答的事实已独立对照 [Standard ML Basis Library TextIO](https://smlfamily.github.io/Basis/text-io.html) 核实。模型实际打开的来源为 [SML/NJ TextIO 文档](https://www.cs.princeton.edu/~appel/smlnj/basis/text-io.html)，记录保留搜索和打开的链接。未把课件第 48 页的概括当作语言规范。

五轮回答均完成；22 处课件引用均能解析为实际提供的来源。跨页读取的两项来源均标记为图像来源，关闭联网后的轮次没有网页调用，关闭两类工具后的框选轮次没有工具调用。数学和代码核对采用原页内容与手工推导；本轮未安装或运行 SML 编译器，也未对 90 页逐页生成答案。

## 发现并修复的问题

1. 模型按钮第二次点击时，弹层的外部点击处理先关闭、按钮随后又打开。改为识别实际菜单触发按钮，二次点击关闭正常，并补充展开状态标记。
2. 追问后点击「跟随当前页」会同时清掉追问目标。将解除页面锁定与取消追问分离；真实第 51→54、54→84 页追问都保留正确目标。修改问题时保留原资料，避免上下文控件造成界面与实际提交不一致。
3. 中文正文紧接带引号或冒号的粗体时，CommonMark 有时显示原始星号。加入仅处理正文的标记规范化，保护代码块、行内代码和公式，并用实际渲染测试覆盖复现文本。

## 界面、导出与数据

- 上翻历史时没有被流式回答拉回底部；生成期间填写的新草稿刷新后保留，会话恢复为完整五轮。
- 搜索「静态作用域」首项命中第 75 页；本次浏览器测得请求与结果显示约 61 ms，仅代表当前本机这次测量。
- 来源键盘聚焦出现含真实缩略图的预览，Enter 跳至第 87 页；复制回答包含可读的课件名与页码。
- 通过界面下载 Markdown，包含五轮问题、回答和来源说明；不打包截图。文件见 [导出的实课问答](output/user-course-check/PowerPointer-实课问答.md)。
- 1036×954 并排阅读、展开问答及 760×850 窄屏抽屉均检查通过；表格、代码、公式和中文粗体正常，无页面横向溢出。
- 操作前备份为 `output/backups/library-before-powerpointer.sqlite`。原有 23 个会话及 17 条问答逐条一致；新增验收会话单独保存。
- `npm test`：23/23；TypeScript 与 Vite 构建通过。Vite 仍提示主包较大，当前未发现影响本机流程的加载故障。当前静态 PPT 阅读仍不播放动画或视频。

## 可复查证据

- [五轮实际快照、回答和工具记录](output/user-course-check/session.json)
- [模型、追问关联、工具、引用及历史保存断言](output/user-course-check/assertions.json)
- [界面回归脚本](scripts/qa-course-final.js) / [两个交互问题复测](scripts/qa-course-reproduce.js)
- [并排阅读截图](output/playwright/powerpointer-final.png) / [跨页推导表格](output/playwright/powerpointer-crosspage-table.png) / [联网回答](output/playwright/powerpointer-web-answer.png) / [窄屏](output/playwright/powerpointer-narrow.png)

`scripts/qa-course-*.js` 的发送脚本会使用真实模型额度；不要为查看记录而重复发送。`qa-course-assert.mjs` 只读检查本地记录，不调用模型。
