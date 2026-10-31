import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.ts";
import { Codex } from "../server/codex.ts";
import { AIConfig } from "../server/ai-config.ts";
import { SecretVault } from "../server/ai-vault.ts";
import { invokeProvider, sse } from "../server/ai-provider.ts";
import { AIRuntime } from "../server/ai-runtime.ts";
import { ExternalServices, publicAddress, readPublicPage } from "../server/ai-external.ts";
import { ArtifactStore } from "../server/ai-artifacts.ts";
import { ResearchTools, serveToolBroker } from "../server/ai-tool-broker.ts";
import { ResearchService } from "../server/ai-research.ts";
import { NotesService } from "../server/notes.ts";
import { Scheduler } from "../server/scheduler.ts";
import { ChatService } from "../server/chat.ts";
import { connectionPresets, defaultEffort, modelEfforts, type AIConnection, type ResearchRun, type ResearchArtifact } from "../shared/ai.ts";
import type { Document, Turn } from "../shared/types.ts";

test("思考强度：默认值计入可选项，不支持推理时不发送，空白项被忽略", async () => {
  const model = (values: object) => ({ defaultReasoningEffort: "", supportedReasoningEfforts: [], capabilities: { vision: true, tools: true, reasoning: true as boolean | "unknown" }, ...values });
  assert.deepEqual(modelEfforts(model({ defaultReasoningEffort: "high" })), ["high"]);
  assert.deepEqual(modelEfforts(model({ defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: " ", description: "" }, { reasoningEffort: "high", description: "" }] })), ["low", "high"]);
  assert.deepEqual(modelEfforts(model({ defaultReasoningEffort: "high", capabilities: { vision: true, tools: true, reasoning: false } })), []);
  assert.equal(defaultEffort(model({ defaultReasoningEffort: "high", capabilities: { vision: true, tools: true, reasoning: false } })), "");
  assert.deepEqual(connectionPresets.find(p => p.id === "deepseek")?.reasoningEfforts, ["low", "high", "max"]);
  const f = fixture();
  try {
    const m = f.c.models[0];
    Object.assign(m, { defaultReasoningEffort: "high", supportedReasoningEfforts: [], capabilities: { vision: true, tools: true, reasoning: true } });
    f.store.put("aiConnection", f.c);
    assert.equal((await f.config.resolve({ connectionId: f.c.id, model: "fixture" })).settings.reasoningEffort, "high");
    await assert.rejects(() => f.config.resolve({ connectionId: f.c.id, model: "fixture", reasoningEffort: "max" }), /不支持此思考强度/);
    m.capabilities!.reasoning = false; f.store.put("aiConnection", f.c);
    assert.equal((await f.config.resolve({ connectionId: f.c.id, model: "fixture" })).settings.reasoningEffort, undefined);
    const saved = await f.config.saveConnection(f.c.id, { ...f.c, hasKey: undefined, models: [{ ...m, defaultReasoningEffort: " high ", supportedReasoningEfforts: [{ reasoningEffort: " low", description: "" }, { reasoningEffort: "", description: "" }] }] });
    assert.equal(saved.models[0].defaultReasoningEffort, "high");
    assert.deepEqual(saved.models[0].supportedReasoningEfforts.map(e => e.reasoningEffort), ["low"]);
  } finally { await f.close(); }
});

test("预设服务的已有模型未填强度时使用官方列表，用户填写和未确认能力不受影响", async () => {
  const f = fixture();
  try {
    const caps = (reasoning: boolean | "unknown") => ({ vision: true, tools: true, reasoning });
    const model = (id: string, reasoning: boolean | "unknown", defaultReasoningEffort = "", list: string[] = []) => ({ model: id, displayName: id, isDefault: false, defaultReasoningEffort, supportedReasoningEfforts: list.map(reasoningEffort => ({ reasoningEffort, description: "" })), capabilities: caps(reasoning) });
    const c = { ...connection("http://127.0.0.1:1"), preset: "deepseek", models: [model("blank", true), model("only-default", true, "high"), model("custom", true, "max", ["max"]), model("unknown", "unknown"), model("off", false)] };
    f.store.put("aiConnection", c);
    const efforts = async (id: string) => { const m = (await f.config.models(c.id)).find(m => m.model === id)!; return [m.supportedReasoningEfforts.map(e => e.reasoningEffort), m.defaultReasoningEffort]; };
    assert.deepEqual(await efforts("blank"), [["low", "high", "max"], "high"]);
    assert.deepEqual(await efforts("only-default"), [["low", "high", "max"], "high"]);
    assert.deepEqual(await efforts("custom"), [["max"], "max"]);
    assert.deepEqual(await efforts("unknown"), [[], ""]);
    assert.deepEqual(await efforts("off"), [[], ""]);
    assert.equal((await f.config.resolve({ connectionId: c.id, model: "blank", reasoningEffort: "max" })).settings.reasoningEffort, "max");
    assert.equal((await f.config.resolve({ connectionId: c.id, model: "blank" })).settings.reasoningEffort, "high");
    assert.deepEqual(f.config.connection(c.id).models[0].supportedReasoningEfforts.map(e => e.reasoningEffort), ["low", "high", "max"]);
    const plain = { ...c, id: randomUUID(), preset: "custom" };
    f.store.put("aiConnection", plain);
    assert.deepEqual((await f.config.models(plain.id)).find(m => m.model === "blank")!.supportedReasoningEfforts, []);
  } finally { await f.close(); }
});

test("兼容接口在工具多轮中回传 reasoning_content，没有时不添加", async () => {
  const s = await server((body, _req, res) => {
    if (body.messages.some((m: any) => m.role === "tool")) { chat(res, "完成"); return; }
    events(res, [
      { choices: [{ delta: { reasoning_content: "先读" } }] },
      { choices: [{ delta: { reasoning_content: "第一页" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-a", type: "function", function: { name: "read", arguments: "{}" } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
  });
  try {
    const req = { model: "fixture", system: "", effort: "high", tools: [{ name: "read", description: "", inputSchema: {} }], messages: [{ role: "user" as const, text: "问题" }], signal: new AbortController().signal };
    const first = await invokeProvider(connection(s.url), "", req);
    await invokeProvider(connection(s.url), "", { ...req, messages: [...req.messages, { role: "assistant", text: first.text, toolCalls: first.toolCalls, providerData: first.providerData }, { role: "tool", text: "资料", toolCallId: "call-a" }] });
    const wire = s.requests[1].body;
    assert.equal(wire.reasoning_effort, "high");
    assert.equal(wire.messages.find((m: any) => m.role === "assistant").reasoning_content, "先读第一页");
    assert.equal(wire.messages.find((m: any) => m.role === "user").reasoning_content, undefined);
    await invokeProvider(connection(s.url), "", { ...req, messages: [...req.messages, { role: "assistant", text: "旧回答" }, { role: "tool", text: "资料", toolCallId: "call-b" }] });
    assert.equal("reasoning_content" in s.requests[2].body.messages.find((m: any) => m.role === "assistant"), false);
  } finally { await s.close(); }
});

async function server(handler: (body: any, req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  const requests: { body: any; path: string; headers: IncomingMessage["headers"] }[] = [];
  const s = createServer(async (req, res) => {
    try { let text = ""; for await (const chunk of req) text += chunk; const body = text ? JSON.parse(text) : {}; requests.push({ body, path: req.url || "", headers: req.headers }); await handler(body, req, res); }
    catch { if (!res.writableEnded) res.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => s.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, requests, async close() { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); } };
}
function events(res: ServerResponse, data: any[]) { res.writeHead(200, { "Content-Type": "text/event-stream" }); for (const event of data) res.write(`data: ${JSON.stringify(event)}\n\n`); res.end(); }
function chat(res: ServerResponse, text = "", calls: any[] = []) { events(res, [{ choices: [{ delta: { content: text, ...(calls.length ? { tool_calls: calls.map((c, i) => ({ index: i, id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) } }] }, { choices: [{ delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }]); }
function connection(url: string, protocol: AIConnection["protocol"] = "compatible", id = randomUUID()): AIConnection {
  return { id, name: "协议夹具", protocol, baseUrl: url, enabled: true, createdAt: "2026-10-23", updatedAt: "2026-10-23", models: [{ model: "fixture", displayName: "Fixture", isDefault: true, defaultReasoningEffort: "", supportedReasoningEfforts: [], capabilities: { vision: true, tools: true, reasoning: false } }] };
}
function fixture(url = "http://127.0.0.1:1") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pointer-ai-")), store = new Store(dir);
  mkdirSync(path.join(dir, "knowledge-runtime"));
  const doc: Document = { id: "a".repeat(64), name: "导数.pdf", pages: 3, indexedPages: 3, indexStatus: "ready", page: 1, rotation: 0, zoom: 1, createdAt: "2026-10-23" };
  store.put("document", doc); store.page(doc.id, 1, "导数 derivative 表示函数的瞬时变化率。"); store.page(doc.id, 2, "微分是导数的局部线性近似。必须检查可微条件。"); store.page(doc.id, 3, "积分用于求面积。");
  const config = new AIConfig(store, { models: async () => [] } as unknown as Codex, () => {});
  const c = connection(url); store.put("aiConnection", c);
  const runtime = new AIRuntime(config), external = new ExternalServices(config), artifacts = new ArtifactStore(store, () => {}), scheduler = new Scheduler(2);
  const research = new ResearchService(config, runtime, external, artifacts, scheduler, () => {});
  return { dir, store, doc, config, c, runtime, external, artifacts, research, async close() { research.close(); await new Promise(resolve => setTimeout(resolve, 30)); store.close(); assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "pointer-ai-"))); rmSync(dir, { recursive: true, force: true }); } };
}
function task(f: ReturnType<typeof fixture>): ResearchRun {
  const now = new Date().toISOString();
  return { id: randomUUID(), documentId: f.doc.id, page: 1, scope: "page", title: "核查导数", goal: "核查导数", settings: { connectionId: f.c.id, model: "fixture", textOnly: true }, assistant: f.config.assistant("research"), context: f.runtime.context([f.doc.id]), state: "running", mode: "research", steps: [], messages: [], answer: "", sources: [], artifactIds: [], calls: 0, callLimit: 20, elapsedMs: 0, timeLimitMs: 900000, createdAt: now, updatedAt: now };
}
async function finish(research: ResearchService, id: string) { for (let i = 0; i < 400; i++) { const r = research.get(id); if (!["running", "queued"].includes(r.state)) { await new Promise(resolve => setTimeout(resolve, 10)); return research.get(id); } await new Promise(resolve => setTimeout(resolve, 10)); } throw Error("任务未在测试时限内结束"); }

test("原生协议：四种接口保留图像、工具调用、用量与服务鉴权，未调用真实服务", async () => {
  const image = "data:image/png;base64,YQ==";
  for (const protocol of ["compatible", "openai", "anthropic", "gemini"] as const) {
    const s = await server((body, req, res) => {
      if (protocol === "compatible") chat(res, "中文", [{ id: "call-1", name: "read", arguments: { page: 2 } }]);
      else if (protocol === "openai") events(res, [{ type: "response.output_text.delta", delta: "中文" }, { type: "response.output_item.done", item: { type: "function_call", call_id: "call-1", name: "read", arguments: '{"page":2}' } }, { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 } } }]);
      else if (protocol === "anthropic") events(res, [{ type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 0 } } }, { type: "content_block_delta", delta: { type: "text_delta", text: "中文" } }, { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call-1", name: "read", input: {} } }, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"page":2}' } }, { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }, { type: "message_stop" }]);
      else events(res, [{ candidates: [{ content: { parts: [{ text: "中文" }, { functionCall: { name: "read", args: { page: 2 } }, thoughtSignature: "opaque-signature" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 } }]);
    });
    try {
      let streamed = "";
      const result = await invokeProvider(connection(s.url, protocol), "fixture-key", { model: "fixture", system: "系统", messages: [{ role: "user", text: "读图" }], images: [image], tools: [{ name: "read", description: "read", inputSchema: { type: "object", properties: { page: { type: "integer" } } } }], signal: new AbortController().signal, onText: text => streamed = text });
      assert.equal(result.text, "中文"); assert.equal(streamed, "中文"); assert.equal(result.toolCalls[0].name, "read"); assert.deepEqual(result.toolCalls[0].arguments, { page: 2 }); assert.equal(result.usage?.total, 17);
      const request = s.requests[0]; assert.ok(JSON.stringify(request.body).includes("YQ==")); assert.ok(JSON.stringify(request.body).includes("read"));
      if (protocol === "compatible" || protocol === "openai") assert.equal(request.headers.authorization, "Bearer fixture-key");
      if (protocol === "anthropic") { assert.equal(request.headers["x-api-key"], "fixture-key"); assert.equal(request.body.max_tokens, 8192); }
      if (protocol === "gemini") { assert.equal(request.headers["x-goog-api-key"], "fixture-key"); assert.equal(result.toolCalls[0].thoughtSignature, "opaque-signature"); }
      assert.ok(!request.path.includes("fixture-key"));
    } finally { await s.close(); }
  }
});

test("事件流处理跨字节中文、截断失败、限流凭据隐藏与取消不重试", async () => {
  const encoded = Buffer.from('data: {"text":"中文"}\r\n\r\n');
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < encoded.length; i += 2) c.enqueue(encoded.subarray(i, i + 2)); c.close(); } });
  const parsed = []; for await (const event of sse(new Response(stream))) parsed.push(event); assert.deepEqual(parsed, [{ text: "中文" }]);
  const truncated = await server((_b, _q, res) => events(res, [{ choices: [{ delta: { content: "部分回答" } }] }]));
  try { await assert.rejects(() => invokeProvider(connection(truncated.url), "", { model: "fixture", system: "", messages: [{ role: "user", text: "问" }], signal: new AbortController().signal }), /提前断开/); assert.equal(truncated.requests.length, 1); } finally { await truncated.close(); }
  const limited = await server((_b, _q, res) => { res.writeHead(429).end('credential=fixture-secret'); });
  try { await assert.rejects(() => invokeProvider(connection(limited.url), "fixture-secret", { model: "fixture", system: "", messages: [], signal: new AbortController().signal }), error => /429/.test(String(error)) && !String(error).includes("fixture-secret")); } finally { await limited.close(); }
  let ready!: () => void; const arrived = new Promise<void>(resolve => ready = resolve);
  const slow = await server((_b, _q, res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); ready(); });
  try { const c = new AbortController(); const promise = invokeProvider(connection(slow.url), "", { model: "fixture", system: "", messages: [], signal: c.signal }); await arrived; c.abort(); await assert.rejects(promise); assert.equal(slow.requests.length, 1); } finally { await slow.close(); }
});

test("原生多轮保留推理签名、独立图像与并行工具结果，不混用调用标识", async () => {
  for (const protocol of ["openai", "anthropic", "gemini"] as const) {
    const s = await server((_body, _req, res) => {
      if (protocol === "openai") events(res, [{ type: "response.output_item.done", item: { type: "reasoning", id: "r1", summary: [], encrypted_content: "opaque" } }, { type: "response.output_item.done", item: { type: "function_call", call_id: "call-a", name: "read", arguments: "{}" } }, { type: "response.completed", response: {} }]);
      else if (protocol === "anthropic") events(res, [{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "test reasoning" } }, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque" } }, { type: "content_block_stop", index: 0 }, { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call-a", name: "read", input: {} } }, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"page":1}' } }, { type: "content_block_stop", index: 1 }, { type: "message_stop" }]);
      else events(res, [{ candidates: [{ content: { parts: [{ functionCall: { name: "read", args: {} }, thoughtSignature: "opaque" }] }, finishReason: "STOP" }] }]);
    });
    try {
      const req = { model: "fixture", system: "", effort: "high", messages: [{ role: "user" as const, text: "first", images: ["data:image/png;base64,YQ=="] }], signal: new AbortController().signal };
      const first = await invokeProvider(connection(s.url, protocol), "", req);
      const second = await invokeProvider(connection(s.url, protocol), "", { ...req, messages: [...req.messages, { role: "assistant", text: first.text, toolCalls: first.toolCalls, providerData: first.providerData }, { role: "tool", text: "one", toolCallId: first.toolCalls[0].id }, { role: "user", text: "second image", images: ["data:image/png;base64,Yg=="] }] });
      const wire = s.requests[1].body, serialized = JSON.stringify(wire);
      assert.ok(serialized.includes("opaque")); assert.ok(serialized.includes("YQ==") && serialized.includes("Yg=="));
      if (protocol === "openai") { assert.equal(wire.reasoning.effort, "high"); assert.ok(wire.include.includes("reasoning.encrypted_content")); }
      if (protocol === "anthropic") { assert.equal(wire.output_config.effort, "high"); assert.equal(wire.messages[1].content[1].input.page, 1); assert.equal(wire.messages[2].content[0].type, "tool_result"); }
      if (protocol === "gemini") { assert.equal(wire.generationConfig.thinkingConfig.thinkingLevel, "HIGH"); assert.notEqual(first.toolCalls[0].id, second.toolCalls[0].id); assert.equal(wire.contents[2].parts[0].functionResponse.name, "read"); }
    } finally { await s.close(); }
  }
});

test("模型以连接区分，未知图像能力不会自动降级或转向其他服务", async () => {
  const f = fixture();
  try {
    const other = connection("http://127.0.0.1:2"); other.models[0].capabilities!.vision = "unknown"; f.store.put("aiConnection", other);
    const catalog = await f.config.models(); assert.equal(catalog.filter(m => m.model === "fixture").length, 2);
    assert.equal((await f.config.resolve({ connectionId: f.c.id, model: "fixture" }, true)).connection.id, f.c.id);
    await assert.rejects(() => f.config.resolve({ connectionId: other.id, model: "fixture" }, true), /尚未确认支持图像/);
    assert.equal((await f.config.resolve({ connectionId: other.id, model: "fixture", textOnly: true })).connection.id, other.id);
    await assert.rejects(() => f.config.resolve({ connectionId: other.id, model: "missing" }), /没有可用模型/);
  } finally { await f.close(); }
});

test("Windows 凭据仅以 DPAPI 密文持久化，可重开恢复与清除", { skip: process.platform !== "win32" }, async () => {
  const f = fixture();
  try { const vault = new SecretVault(f.store), secret = "fixture-非真实密钥-" + randomUUID(); await vault.set("example", secret); assert.ok(vault.has("example")); assert.equal(await new SecretVault(f.store).get("example"), secret); assert.ok(!JSON.stringify(f.store.all("aiSecret")).includes(secret)); assert.ok(!readFileSync(path.join(f.dir, "library.sqlite")).includes(Buffer.from(secret))); await vault.set("example", ""); assert.equal(await vault.get("example"), ""); } finally { await f.close(); }
});

test("研究工具遵守页码范围、核对真实引用、保留笔记版本并去重写入", async () => {
  const f = fixture(), r = task(f), tools = new ResearchTools(r, f.external, f.artifacts, () => {});
  try {
    await assert.rejects(() => tools.call("read_pages", { pages: [2] }, "outside", new AbortController().signal), /范围/);
    const read = await tools.call("read_pages", { pages: [1] }, "read", new AbortController().signal), source = JSON.parse(read.text).sources[0];
    await assert.rejects(() => tools.call("create_artifact", { title: "报告", kind: "report", text: "[引用](source:fake)" }, "bad-cite", new AbortController().signal), /未实际读取/);
    const args = { title: "研究报告", kind: "report", text: `[导数](source:${source.id})` };
    const first = await tools.call("create_artifact", args, "write-1", new AbortController().signal);
    const second = await tools.call("create_artifact", args, "different-call-id", new AbortController().signal);
    assert.deepEqual(first, second); assert.equal(f.store.all("aiArtifact").length, 1);
    const artifact = JSON.parse(first.text);
    await tools.call("update_artifact", { id: artifact.id, version: 1, text: "新版" }, "edit-1", new AbortController().signal);
    await tools.call("update_artifact", { id: artifact.id, version: 1, text: "新版" }, "edit-2", new AbortController().signal);
    assert.equal(f.artifacts.get(artifact.id).version, 2); assert.equal(f.artifacts.versions(artifact.id).length, 2);
    assert.throws(() => f.artifacts.edit(artifact.id, { text: "覆盖", version: 1 }), /新版本/);
    assert.equal(f.artifacts.revert(artifact.id, 1, 2).text, args.text);
    const notes = new NotesService(f.store, () => {}), note = notes.create({ documentId: f.doc.id, title: "导数", text: "原始理解" });
    f.store.put("note", { ...note, sources: [source] });
    await assert.rejects(() => tools.call("update_note", { id: note.id, version: 1, text: "修订" }, "unread", new AbortController().signal), /必须.*读取/);
    await tools.call("search_notes", { query: "导数" }, "notes", new AbortController().signal);
    await tools.call("update_note", { id: note.id, version: 1, text: "修订" }, "note-edit", new AbortController().signal);
    assert.equal(f.store.get<any>("noteVersion", `${note.id}:1`).text, "原始理解");
    assert.equal(notes.get(note.id).text, "修订");
    const bridge = await serveToolBroker(tools, new AbortController().signal);
    try { assert.equal((await fetch(bridge.url, { method: "POST", body: "{}" })).status, 403); const response = await fetch(bridge.url, { method: "POST", headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_shell", arguments: {} } }) }); assert.equal((await response.json() as any).result.isError, true); } finally { await bridge.close(); }
  } finally { tools.close(); await f.close(); }
});

test("研究 Agent 使用真实工具结果形成成果，重复启动不重复请求", async () => {
  let count = 0, source = "";
  const s = await server((body, _req, res) => {
    count++;
    if (count === 1) chat(res, "", [{ id: "search-1", name: "search_course", arguments: { query: "导数" } }]);
    else if (count === 2) { const result = body.messages.findLast((m: any) => m.role === "tool"); source = JSON.parse(result.content).sources[0].id; chat(res, "", [{ id: "create-1", name: "create_artifact", arguments: { title: "导数研究", kind: "report", text: `导数是瞬时变化率。[依据](source:${source})` } }]); }
    else chat(res, `研究完成。[原文](source:${source})`);
  });
  const f = fixture(s.url);
  try {
    const input = { id: randomUUID(), documentId: f.doc.id, goal: "核查导数与微分", settings: { connectionId: f.c.id, model: "fixture", textOnly: true } };
    const started = await f.research.create(input), duplicate = await f.research.create(input); assert.equal(duplicate.id, started.id);
    const result = await finish(f.research, started.id); assert.equal(result.state, "completed", result.error); assert.equal(result.calls, 3); assert.equal(count, 3); assert.equal(result.artifactIds.length, 1); assert.ok(result.sources.some(s => s.id === source)); assert.ok(result.steps.some(s => s.tool === "create_artifact" && s.state === "completed")); assert.equal(f.store.all("aiUsage").length, 3);
    const adopted = f.research.adopt(result.id, 0); assert.equal(f.store.all<Turn>("turn").find(t => t.conversationId === adopted.id)?.connectionId, f.c.id);
  } finally { await f.close(); await s.close(); }
});

test("阶段暂停保留已完成工具，继续不重做；20 轮上限暂停且重启不自动重发", async () => {
  let count = 0, release!: () => void;
  const first = new Promise<void>(resolve => release = resolve);
  const s = await server(async (_body, _req, res) => { count++; if (count === 1) await first; chat(res, "", [{ id: `notes-${count}`, name: "search_notes", arguments: { query: "" } }]); });
  const f = fixture(s.url);
  try {
    const started = await f.research.create({ documentId: f.doc.id, goal: "逐步研究", settings: { connectionId: f.c.id, model: "fixture", textOnly: true } });
    for (let i = 0; i < 100 && count === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
    f.research.stop(started.id, true); release(); const paused = await finish(f.research, started.id); assert.equal(paused.state, "paused"); assert.equal(paused.calls, 1); assert.equal(paused.messages.filter(m => m.role === "tool").length, 1);
    f.research.resume(started.id); const limited = await finish(f.research, started.id); assert.equal(limited.state, "paused"); assert.equal(limited.calls, 21); assert.match(limited.error || "", /上限/); assert.equal(count, 21);
    f.store.put("aiResearch", { ...limited, state: "running" });
    const restarted = new ResearchService(f.config, f.runtime, f.external, f.artifacts, new Scheduler(2), () => {}); assert.equal(restarted.get(started.id).state, "unknown"); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(count, 21);
  } finally { release(); await f.close(); await s.close(); }
});

test("双模型收到同一份资料，失败的一侧不覆盖成功回答", async () => {
  let fail = true;
  const s = await server((_body, req, res) => { if (req.url?.startsWith("/second") && fail) res.writeHead(429).end(); else chat(res, "根据共同资料得到的结论"); });
  const f = fixture(s.url), second = connection(s.url + "/second"); f.store.put("aiConnection", second);
  try {
    const r = await f.research.create({ documentId: f.doc.id, goal: "对比导数定义", mode: "compare", settings: { connectionId: f.c.id, model: "fixture", textOnly: true }, compareSettings: { connectionId: second.id, model: "fixture", textOnly: true } });
    const failed = await finish(f.research, r.id); assert.equal(failed.state, "failed"); assert.equal(failed.comparison?.[0].state, "completed"); assert.equal(failed.comparison?.[1].state, "failed"); assert.deepEqual(s.requests[0].body.messages, s.requests[1].body.messages); assert.equal(s.requests[0].body.tools, undefined);
    fail = false; f.research.resume(r.id); const completed = await finish(f.research, r.id); assert.equal(completed.state, "completed"); assert.equal(s.requests.length, 3); assert.equal(f.research.adopt(r.id, 1).connectionId, second.id);
  } finally { await f.close(); await s.close(); }
});

test("外部 MCP 仅执行已启用且按助手授权的只读工具，定义变更会阻止调用", async () => {
  let changed = false, calls = 0;
  const definition = () => ({ name: "lookup", description: "read data", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true, destructiveHint: changed } });
  const s = await server((body, _req, res) => { if (body.id === undefined) { res.writeHead(202).end(); return; } let result: any = {}; if (body.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} } }; if (body.method === "tools/list") result = { tools: [definition(), { name: "write", description: "write", inputSchema: {}, annotations: { readOnlyHint: false } }] }; if (body.method === "tools/call") { calls++; result = { content: [{ type: "text", text: "actual result" }] }; } res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result })); });
  const f = fixture();
  try {
    const c = await f.external.save(undefined, { name: "测试 MCP", url: s.url, enabled: true });
    const discovered = await f.external.discover(c.id); assert.ok(discovered.tools.every(t => !t.enabled));
    await f.external.save(c.id, { name: c.name, url: c.url, enabled: true, enabledToolIds: discovered.tools.map(t => t.id) });
    const assistant = f.config.assistant("research"); assistant.mcpToolIds = discovered.tools.map(t => t.id); f.config.saveAssistant(assistant.id, assistant);
    const tools = f.external.specs(assistant); assert.equal(tools.length, 1);
    const actual = await f.external.call(assistant, tools[0].name, {}, new AbortController().signal); assert.equal(actual.content, "actual result"); assert.equal(calls, 1);
    changed = true; await assert.rejects(() => f.external.call(assistant, tools[0].name, {}, new AbortController().signal), /定义已变更/); assert.equal(calls, 1);
    assert.equal(publicAddress("127.0.0.1"), false); assert.equal(publicAddress("192.168.1.1"), false); assert.equal(publicAddress("::1"), false); assert.equal(publicAddress("::ffff:127.0.0.1"), false); assert.equal(publicAddress("8.8.8.8"), true);
    await assert.rejects(() => readPublicPage("http://127.0.0.1/", new AbortController().signal), /私有网络|本机/);
  } finally { await f.close(); await s.close(); }
});
