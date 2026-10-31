import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Document, Conversation, Turn } from "../shared/types.ts";
const base = "http://127.0.0.1:17317";
const init = await fetch(base + "/api/bootstrap"),
  { csrf } = (await init.json()) as any;
const headers = {
  cookie: `lecture_session=${csrf}`,
  "x-lecture-token": csrf,
  "content-type": "application/json",
};
async function api<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(base + "/api" + url, {
    headers,
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v as T;
}
const docs = await api<Document[]>("/documents"),
  doc = docs.find((d) => d.name === "微积分 图形验证.pptx")!;
if (!doc) throw Error("验证课件不存在");
const c = await api<Conversation>(`/documents/${doc.id}/conversations`, {});
const record: any = {
  date: new Date().toISOString(),
  documentId: doc.id,
  conversationId: c.id,
  turns: [],
};
mkdirSync("output/chat-check", { recursive: true });
const save = () =>
  writeFileSync(
    "output/chat-check/real-agent.json",
    JSON.stringify(record, null, 2),
  );
save();
const t = await api<Turn>("/turns", {
  requestId: randomUUID(),
  question:
    "请先调用课件工具读取第4页的图像，再检索课件中的导数定义。回答第4页的完整口令、红色图形数量和蓝色图形形状，再用一句话解释导数，并引用来源。把本轮学习索引记为雪松418，供后续讨论引用。",
  snapshot: {
    documentId: doc.id,
    conversationId: c.id,
    page: 1,
    rotation: 0,
    selectedText: "",
    scope: "full",
    extraPages: [],
    answerLength: "standard",
    model: "gpt-6.1-sol",
    reasoningEffort: "medium",
    agentTools: true,
    webSearch: false,
  },
});
async function wait(turn: Turn) {
  let last = "";
  for (let i = 0; i < 200; i++) {
    const v = (
      await api<Turn[]>(`/conversations/${turn.conversationId}/turns`)
    ).find((x) => x.id === turn.id)!;
    const status =
      v.state +
      " " +
      (v.tools || []).map((x) => `${x.title}:${x.state}`).join(", ");
    if (status !== last) {
      console.log(status);
      last = status;
    }
    if (!["preparing", "generating"].includes(v.state)) {
      record.turns.push(v);
      save();
      console.log(v.answer, v.error || "");
      return v;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw Error("验证超时");
}
const first = await wait(t);
if (first.state !== "completed") throw Error(first.error || "未完成");
record.checks = {
  image: /银杏\s*862/.test(first.answer) && /三角/.test(first.answer),
  readTool: first.tools?.some(
    (t) => t.title === "读取课件页面" && t.state === "completed",
  ),
  searchTool: first.tools?.some(
    (t) => t.title === "检索课件" && t.state === "completed",
  ),
  sources: (first.toolSources?.length || 0) > 0,
};
save();
console.log(JSON.stringify(record.checks));
if (!Object.values(record.checks).every(Boolean))
  throw Error("真实课件工具验证未通过");
