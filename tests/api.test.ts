import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api.ts";

test("本地服务不可达时给出中文说明，主动取消仍按取消处理", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(api("/documents"), (e: Error) => /无法连接本地服务/.test(e.message));
    const aborted = new DOMException("The operation was aborted", "AbortError");
    globalThis.fetch = (async () => {
      throw aborted;
    }) as typeof fetch;
    await assert.rejects(api("/documents"), (e: Error) => e === aborted);
  } finally {
    globalThis.fetch = original;
  }
});
