import test from "node:test";
import assert from "node:assert/strict";
import { TurnTokens } from "../server/codex.ts";

const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, totalTokens: input + output });

test("一轮的用量包含这一轮的每次模型请求，不含线程之前的累计", () => {
  const tokens = new TurnTokens();
  assert.deepEqual(tokens.update({ last: usage(100, 10), total: usage(1100, 110) }), { input: 100, output: 10, total: 110 });
  assert.deepEqual(tokens.update({ last: usage(200, 20), total: usage(1300, 130) }), { input: 300, output: 30, total: 330 });
});

test("中断后 Codex 重发的旧用量不计入，已完成请求的用量保留", () => {
  const tokens = new TurnTokens();
  assert.deepEqual(tokens.update({ last: usage(100, 10), total: usage(100, 10) }), { input: 100, output: 10, total: 110 });
  tokens.interrupt();
  assert.equal(tokens.update({ last: usage(100, 10), total: usage(100, 10) }), undefined);
  const stale = new TurnTokens();
  stale.interrupt();
  assert.equal(stale.update({ last: usage(2752, 10), total: usage(2752, 10) }), undefined);
});

test("恢复线程时重放的上一轮用量只作为起点，不计入这一轮", () => {
  const tokens = new TurnTokens();
  tokens.begin(usage(2752, 10));
  assert.deepEqual(tokens.update({ last: usage(2454, 10), total: usage(5206, 20) }), { input: 2454, output: 10, total: 2464 });
  assert.deepEqual(tokens.update({ last: usage(100, 5), total: usage(5306, 25) }), { input: 2554, output: 15, total: 2569 });
});

test("服务未返回累计值或累计值回退时，退回使用本次请求的用量", () => {
  assert.deepEqual(new TurnTokens().update({ last: usage(5, 1) }), { input: 5, output: 1, total: 6 });
  const tokens = new TurnTokens();
  tokens.update({ last: usage(100, 10), total: usage(900, 90) });
  assert.deepEqual(tokens.update({ last: usage(5, 1), total: usage(5, 1) }), { input: 5, output: 1, total: 6 });
});
