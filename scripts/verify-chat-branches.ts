import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = "http://127.0.0.1:17317/api",
  { csrf } = await (await fetch(base + "/bootstrap")).json();
const headers = {
  "content-type": "application/json",
  cookie: `lecture_session=${csrf}`,
  "x-lecture-token": csrf,
};
const prior = JSON.parse(
    readFileSync("output/chat-check/real-agent.json", "utf8"),
  ),
  record: any = { date: new Date().toISOString(), turns: [], checks: {} };
const save = () =>
  writeFileSync(
    "output/chat-check/real-branches-web.json",
    JSON.stringify(record, null, 2),
  );
async function api(url: string, body?: any) {
  const r = await fetch(base + url, {
    headers,
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
async function wait(t: any) {
  for (let i = 0; i < 210; i++) {
    const v = (await api(`/conversations/${t.conversationId}/turns`)).find(
      (x: any) => x.id === t.id,
    );
    if (!["preparing", "generating"].includes(v.state)) {
      record.turns.push(v);
      save();
      console.log(v.state, v.model, v.answer, v.error || "");
      assert.equal(v.state, "completed");
      return v;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error("timeout");
}
async function send(question: string, settings: any = {}) {
  return wait(
    await api("/turns", {
      question,
      requestId: randomUUID(),
      snapshot: {
        ...prior.turns[0].snapshot,
        images: undefined,
        sources: undefined,
        agentTools: false,
        webSearch: false,
        model: "gpt-6-luna",
        reasoningEffort: "low",
        ...settings,
      },
    }),
  );
}
try {
  const second = await send(
    "请联网检索并打开MDN官方文档，核对JavaScript Array.prototype.map是否修改原数组，给出直接来源链接。另记本轮临时索引为紫藤907。",
    { webSearch: true },
  );
  record.checks.web =
    second.tools?.some(
      (x: any) => x.kind === "web" && x.state === "completed",
    ) && /https:\/\/developer.mozilla.org/.test(second.answer);
  assert.ok(record.checks.web);
  record.checks.modelSwitch =
    second.model === "gpt-6-luna" && second.reasoningEffort === "low";
  assert.ok(record.checks.modelSwitch);
  const third = await send(
    "只用会话历史：第一轮学习索引与最近一轮临时索引分别是什么？不要调用工具。",
  );
  record.checks.restore =
    /雪松\s*418/.test(third.answer) &&
    /紫藤\s*907/.test(third.answer) &&
    !third.tools?.length;
  assert.ok(record.checks.restore);
  const original = JSON.stringify(
    await api(`/conversations/${prior.conversationId}/turns`),
  );
  const body = {
    requestId: randomUUID(),
    question:
      "请只用之前的会话记忆回答：第一轮学习索引是什么？是否已出现过临时索引？如果没有则回答“未提供”，不要猜测。",
    options: {
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      agentTools: false,
      webSearch: false,
      answerLength: "short",
    },
  };
  const branch = await api(`/turns/${second.id}/branch`, body),
    duplicate = await api(`/turns/${second.id}/branch`, body);
  assert.equal(branch.id, duplicate.id);
  const child = await wait(branch);
  record.checks.branchMemory =
    /雪松\s*418/.test(child.answer) &&
    /未提供/.test(child.answer) &&
    !/907/.test(child.answer);
  assert.ok(record.checks.branchMemory);
  record.checks.originalUnchanged =
    original ===
    JSON.stringify(await api(`/conversations/${prior.conversationId}/turns`));
  assert.ok(record.checks.originalUnchanged);
  const childTurns = await api(`/conversations/${child.conversationId}/turns`);
  assert.equal(childTurns.length, 2);
  record.checks.branchPrefix = true;
  const firstBranch = await wait(
    await api(`/turns/${prior.turns[0].id}/branch`, {
      requestId: randomUUID(),
      question: "此会话之前是否提供过学习索引？若没有就只回答“未提供”。",
      options: {
        model: "gpt-6-luna",
        reasoningEffort: "low",
        agentTools: false,
        webSearch: false,
        answerLength: "short",
      },
    }),
  );
  record.checks.firstFresh =
    /未提供/.test(firstBranch.answer) && !/418/.test(firstBranch.answer);
  assert.ok(record.checks.firstFresh);
  console.log(record.checks);
} finally {
  save();
}
