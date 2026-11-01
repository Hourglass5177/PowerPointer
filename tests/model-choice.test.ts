import test from "node:test";
import assert from "node:assert/strict";
import { currentModel, selectedModel } from "../shared/ai.ts";
import type { AIModel } from "../shared/types.ts";

const model = (connectionId: string, id: string, isDefault = false) =>
  ({ connectionId, model: id, displayName: id, isDefault, defaultReasoningEffort: "", supportedReasoningEfforts: [] }) as AIModel;
const models = [model("codex", "gpt-6-astra", true), model("codex", "gpt-5.6-luna"), model("ds", "deepseek-flash"), model("ds", "deepseek-v4-pro", true)];

test("没有明确选择时用当前连接的默认模型，不会用到其他连接的默认模型", () => {
  assert.equal(currentModel(models, {}, undefined, "ds")?.model, "deepseek-v4-pro");
  assert.equal(currentModel(models, {}, undefined, "codex")?.model, "gpt-6-astra");
});

test("输入框选了模型时跟随选择，会话模型只在同一连接下沿用", () => {
  assert.equal(currentModel(models, { connectionId: "ds", model: "deepseek-flash" }, { connectionId: "codex", model: "gpt-5.6-luna" }, "codex")?.model, "deepseek-flash");
  assert.equal(currentModel(models, {}, { connectionId: "codex", model: "gpt-5.6-luna" }, "ds")?.model, "gpt-5.6-luna");
  assert.equal(currentModel(models, { connectionId: "ds" }, { connectionId: "codex", model: "gpt-5.6-luna" }, "codex")?.model, "deepseek-v4-pro");
  assert.equal(currentModel(models, { connectionId: "codex" }, { connectionId: "codex", model: "gpt-5.6-luna" }, "ds")?.connectionId, "codex");
});

test("选定的模型不存在时不回退到其他模型", () => {
  assert.equal(selectedModel(models, { connectionId: "ds", model: "removed" }, "ds"), undefined);
  assert.equal(currentModel(models, { connectionId: "ds", model: "removed" }, undefined, "ds"), undefined);
});
