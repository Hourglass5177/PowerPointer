import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { Codex } from "../server/codex.ts";

const ancestor = "01a19c23-bf0d-7841-af23-e2d7d9871f29";
const lag = `failed to prepare paginated fork: thread-store internal error: thread history projection for ${ancestor} is behind durable rollout`;

function setup(t: TestContext, reply: (method: string, params: any) => unknown) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lecture-fork-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls: { method: string; params: any }[] = [];
  t.mock.method(Codex.prototype, "connect", async () => {});
  t.mock.method(Codex.prototype, "rpc", async (method: string, params: any) => {
    calls.push({ method, params });
    return reply(method, params);
  });
  return { codex: new Codex(dir), calls };
}

for (const exclusive of [false, true]) test(`历史索引暂时落后时重试，保持${exclusive ? "排除" : "包含"}轮次边界`, async t => {
  let forks = 0;
  const { codex, calls } = setup(t, method => {
    if (method === "thread/fork") {
      if (++forks === 1) throw Error(lag);
      return { thread: { id: "child" } };
    }
    return {};
  });
  assert.equal(await codex.fork("model", "chapter", exclusive ? "excluded" : undefined, "completed"), "child");
  assert.deepEqual(calls.map(c => c.method), ["thread/fork", "thread/read", "thread/fork", "thread/unsubscribe"]);
  assert.deepEqual(calls[1].params, { threadId: ancestor, includeTurns: true });
  assert.deepEqual(calls[0].params, calls[2].params);
  assert.equal(calls[2].params.threadId, "chapter");
  assert.equal(calls[2].params.model, "model");
  assert.equal(calls[2].params.beforeTurnId, exclusive ? "excluded" : undefined);
  assert.equal(calls[2].params.lastTurnId, exclusive ? undefined : "completed");
});

test("索引持续落后时限次结束，保留中文重试提示和原始原因", async t => {
  const { codex, calls } = setup(t, method => {
    if (method === "thread/fork") throw Error(lag);
    if (method === "thread/read") throw Error("history temporarily unavailable");
    throw Error(`不应调用 ${method}`);
  });
  await assert.rejects(codex.fork("model", "chapter", undefined, "completed"), (error: Error) => {
    assert.match(error.message, /阅读历史仍在同步.*稍后重试/);
    assert.equal((error.cause as Error).message, lag);
    return true;
  });
  const forks = calls.filter(c => c.method === "thread/fork");
  assert.equal(forks.length, 4);
  assert.ok(forks.every(c => c.params.lastTurnId === "completed"));
  assert.ok(calls.every(c => ["thread/fork", "thread/read"].includes(c.method)));
});

test("权限和普通内部错误不重试、不改用其他分支位置", async t => {
  const failure = Error("permission denied");
  const { codex, calls } = setup(t, () => { throw failure; });
  await assert.rejects(codex.fork("model", "chapter", "excluded", "completed"), error => error === failure);
  assert.equal(calls.length, 1);
});

test("旧版不支持排除边界时仍可使用已完成边界，并恢复索引落后", async t => {
  let forks = 0;
  const { codex, calls } = setup(t, (method, params) => {
    if (method === "thread/fork") {
      forks++;
      if (params.beforeTurnId) throw Error("unsupported beforeTurnId");
      if (forks === 2) throw Error(lag);
      return { thread: { id: "child" } };
    }
    return {};
  });
  assert.equal(await codex.fork("model", "chapter", "excluded", "completed"), "child");
  const requests = calls.filter(c => c.method === "thread/fork");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].params.beforeTurnId, "excluded");
  for (const { params } of requests.slice(1)) {
    assert.equal(params.beforeTurnId, undefined);
    assert.equal(params.lastTurnId, "completed");
  }
});

test("没有可靠边界时不调用 fork", async t => {
  const { codex, calls } = setup(t, () => { throw Error("不应调用"); });
  await assert.rejects(codex.fork("model", "chapter"), /缺少可靠的线程切分位置/);
  assert.equal(calls.length, 0);
});
