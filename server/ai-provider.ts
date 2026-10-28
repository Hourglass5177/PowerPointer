import type { AIConnection, ResearchMessage } from "../shared/ai.ts";
import { randomUUID } from "node:crypto";

export interface FunctionTool { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ProviderRequest {
  model: string; system: string; messages: ResearchMessage[]; images?: string[];
  tools?: FunctionTool[]; effort?: string; signal: AbortSignal; onText?: (text: string) => void;
}
export interface ProviderResult {
  text: string; toolCalls: NonNullable<ResearchMessage["toolCalls"]>;
  usage?: { input: number; output: number; total: number };
  providerData?: ResearchMessage["providerData"];
}
export function serviceUrl(base: string, suffix: string) {
  const u = new URL(base);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error("服务地址必须是没有凭据、查询参数或片段的 HTTP(S) URL");
  return base.replace(/\/+$/, "") + suffix;
}
async function jsonResponse(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    const hint = response.status === 401 || response.status === 403 ? "请检查凭据与模型访问权限" : response.status === 429 ? "请求限流或额度不足" : "请检查服务地址和模型配置";
    throw Error(`模型服务返回 HTTP ${response.status}：${hint}`);
  }
  return response;
}
// SSE chunks can split Unicode, event lines, or JSON at any byte boundary.
export async function* sse(response: Response): AsyncGenerator<any> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("服务没有返回响应流");
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (block: string) => {
    const data = block.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return undefined;
    try { return JSON.parse(data); } catch { throw Error("模型返回了无法解析的事件流"); }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const event = parse(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event) yield event;
      }
      if (buffer.length > 8_000_000) throw Error("服务事件过大");
      if (done) { if (buffer.trim()) { const event = parse(buffer); if (event) yield event; } break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function toolArguments(value: unknown): Record<string, unknown> {
  const args = typeof value === "string" ? JSON.parse(value || "{}") : value || {};
  if (!args || typeof args !== "object" || Array.isArray(args)) throw Error("工具参数必须是对象");
  return args;
}
export async function invokeProvider(connection: AIConnection, key: string, req: ProviderRequest): Promise<ProviderResult> {
  const tools = req.tools || [], protocol = connection.protocol;
  let route = "", body: any;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const images = req.images || [];
  const messagesWithImages = req.messages.map(m => ({ ...m }));
  const initialUser = messagesWithImages.find(m => m.role === "user");
  if (initialUser && images.length && !initialUser.images?.length) initialUser.images = images;
  const merge = (items: any[], field: "content" | "parts") => items.reduce((all: any[], m) => {
    if (all.at(-1)?.role === m.role) all.at(-1)[field].push(...m[field]); else all.push({ ...m, [field]: [...m[field]] });
    return all;
  }, []);
  if (protocol === "compatible") {
    route = "/chat/completions";
    const messages: any[] = [{ role: "system", content: req.system }, ...messagesWithImages.map(m => ({ role: m.role, content: m.images?.length ? [{ type: "text", text: m.text }, ...m.images.map(url => ({ type: "image_url", image_url: { url } }))] : m.text || (m.toolCalls ? null : ""), ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}), ...(m.toolCalls ? { tool_calls: m.toolCalls.map(t => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.arguments) } })) } : {}) }))];
    body = { model: req.model, messages, stream: true, ...(tools.length ? { tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}), ...(req.effort ? { reasoning_effort: req.effort } : {}) };
  } else if (protocol === "openai") {
    route = "/responses";
    const input: any[] = messagesWithImages.flatMap<any>(m => m.providerData?.protocol === protocol ? m.providerData.content : m.role === "tool" ? [{ type: "function_call_output", call_id: m.toolCallId, output: m.text }] : [ ...(m.text || m.images?.length ? [{ role: m.role, content: m.images?.length ? [{ type: "input_text", text: m.text }, ...m.images.map(url => ({ type: "input_image", image_url: url }))] : m.text }] : []), ...(m.toolCalls || []).map(t => ({ type: "function_call", call_id: t.id, name: t.name, arguments: JSON.stringify(t.arguments) })) ]);
    body = { model: req.model, instructions: req.system, input, stream: true, store: false, ...(tools.length ? { tools: tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema, strict: false })) } : {}), ...(req.effort ? { reasoning: { effort: req.effort } } : {}) };
    body.include = ["reasoning.encrypted_content"];
  } else if (protocol === "anthropic") {
    route = "/messages"; delete headers.Authorization;
    headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01";
    const messages = merge(messagesWithImages.map(m => ({ role: m.role === "tool" ? "user" : m.role, content: m.providerData?.protocol === protocol ? m.providerData.content : m.role === "tool" ? [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.text }] : [...(m.text ? [{ type: "text", text: m.text }] : []), ...(m.toolCalls || []).map(t => ({ type: "tool_use", id: t.id, name: t.name, input: t.arguments })), ...(m.images || []).map(url => { const [, media_type, data] = /^data:([^;]+);base64,(.*)$/.exec(url)!; return { type: "image", source: { type: "base64", media_type, data } }; })] })), "content");
    body = { model: req.model, system: req.system, messages, max_tokens: 8192, stream: true, ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}) };
    if (req.effort) {
      if (/^budget:\d+$/.test(req.effort)) { const budget = Number(req.effort.slice(7)); if (budget < 1024 || budget > 32768) throw Error("思考预算应为 budget:1024 至 budget:32768"); body.thinking = { type: "enabled", budget_tokens: budget }; body.max_tokens = budget + 8192; }
      else { body.thinking = { type: "adaptive" }; body.output_config = { effort: req.effort }; body.max_tokens = 16384; }
    }
  } else if (protocol === "gemini") {
    route = `/models/${encodeURIComponent(req.model.replace(/^models\//, ""))}:streamGenerateContent?alt=sse`;
    delete headers.Authorization; if (key) headers["x-goog-api-key"] = key;
    const contents = merge(messagesWithImages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: m.providerData?.protocol === protocol ? m.providerData.content : m.role === "tool" ? [{ functionResponse: { name: req.messages.flatMap(x => x.toolCalls || []).find(t => t.id === m.toolCallId)?.name || m.toolCallId, response: { result: m.text } } }] : [...(m.text ? [{ text: m.text }] : []), ...(m.toolCalls || []).map(t => ({ functionCall: { name: t.name, args: t.arguments }, ...(t.thoughtSignature ? { thoughtSignature: t.thoughtSignature } : {}) })), ...(m.images || []).map(url => { const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(url)!; return { inlineData: { mimeType, data } }; })] })), "parts");
    body = { systemInstruction: { parts: [{ text: req.system }] }, contents, ...(tools.length ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }] } : {}) };
    if (req.effort) body.generationConfig = { thinkingConfig: /^budget:-?\d+$/.test(req.effort) ? { thinkingBudget: Number(req.effort.slice(7)) } : { thinkingLevel: req.effort.toUpperCase() } };
  } else throw Error("该协议不使用 HTTP 模型适配器");
  if (protocol === "compatible") body.stream_options = { include_usage: true };
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(180000)]);
  let response: Response;
  try { response = await fetch(serviceUrl(connection.baseUrl, route), { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error" }); }
  catch { if (req.signal.aborted) throw Error("已停止"); throw Error("连接失败或超时，请检查服务地址及网络"); }
  await jsonResponse(response);
  let text = "", usage: ProviderResult["usage"], completed = false;
  const calls = new Map<string, { id: string; name: string; args: string | Record<string, unknown>; thoughtSignature?: string }>();
  const nativeContent: any[] = [];
  const add = (delta: string) => { text += delta; req.onText?.(text); };
  for await (const event of sse(response)) {
    if (event.error || event.type === "error" || event.type === "response.failed") throw Error("模型服务中断了生成，请检查连接状态后重试");
    if (protocol === "compatible") {
      const delta = event.choices?.[0]?.delta;
      const finish = event.choices?.[0]?.finish_reason;
      if (finish === "stop" || finish === "tool_calls") completed = true;
      else if (finish) throw Error("模型输出未完成或受到内容限制，请缩小任务后重试");
      if (typeof delta?.content === "string") add(delta.content);
      for (const call of delta?.tool_calls || []) {
        const index = String(call.index), prev = calls.get(index) || { id: "", name: "", args: "" };
        prev.id ||= call.id; prev.name += call.function?.name || ""; prev.args += call.function?.arguments || ""; calls.set(index, prev);
      }
      if (event.usage) usage = { input: event.usage.prompt_tokens || 0, output: event.usage.completion_tokens || 0, total: event.usage.total_tokens || 0 };
    } else if (protocol === "openai") {
      if (event.type === "response.output_item.done") nativeContent.push(event.item);
      if (event.type === "response.output_text.delta") add(event.delta);
      if (event.type === "response.output_item.done" && event.item?.type === "function_call") calls.set(event.item.call_id, { id: event.item.call_id, name: event.item.name, args: event.item.arguments });
      if (event.type === "response.completed") { completed = true; const u = event.response?.usage; if (u) usage = { input: u.input_tokens, output: u.output_tokens, total: u.total_tokens }; }
      if (event.type === "response.incomplete") throw Error("模型输出未完成（可能达到输出上限），请缩小任务后重试");
    } else if (protocol === "anthropic") {
      if (event.type === "content_block_start") nativeContent[event.index] = structuredClone(event.content_block);
      const block = nativeContent[event.index];
      if (block && event.type === "content_block_delta") {
        if (event.delta.type === "thinking_delta") block.thinking = (block.thinking || "") + event.delta.thinking;
        if (event.delta.type === "signature_delta") block.signature = (block.signature || "") + event.delta.signature;
        if (event.delta.type === "text_delta") block.text = (block.text || "") + event.delta.text;
      }
      if (event.type === "content_block_stop" && block?.type === "tool_use") block.input = toolArguments(calls.get(String(event.index))?.args);
      if (event.type === "message_stop") completed = true;
      if (["max_tokens", "refusal"].includes(event.delta?.stop_reason)) throw Error("模型输出未完成或拒绝了请求");
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") calls.set(String(event.index), { id: event.content_block.id, name: event.content_block.name, args: "" });
      if (event.delta?.type === "text_delta") add(event.delta.text);
      if (event.delta?.type === "input_json_delta") { const c = calls.get(String(event.index)); if (c) c.args += event.delta.partial_json; }
      const u = event.usage || event.message?.usage;
      if (u) { usage = { input: u.input_tokens ?? usage?.input ?? 0, output: u.output_tokens ?? usage?.output ?? 0, total: 0 }; usage.total = usage.input + usage.output; }
    } else {
      for (const p of event.candidates?.[0]?.content?.parts || []) {
        nativeContent.push(p);
        if (p.text && !p.thought) add(p.text);
        if (p.functionCall) { const id = p.functionCall.id || `gemini-${randomUUID()}`; calls.set(id, { id, name: p.functionCall.name, args: p.functionCall.args, thoughtSignature: p.thoughtSignature }); }
      }
      const finish = event.candidates?.[0]?.finishReason;
      if (finish === "STOP") completed = true;
      else if (finish) throw Error("模型输出未完成或受到内容限制");
      const u = event.usageMetadata; if (u) usage = { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, total: u.totalTokenCount || 0 };
    }
  }
  if (!completed) throw Error("模型响应流提前断开，回答结果未确认；请主动重试");
  if ([...calls.values()].some(c => !c.id || !c.name)) throw Error("模型返回的工具调用缺少标识或名称");
  return { text, toolCalls: [...calls.values()].map(c => ({ id: c.id, name: c.name, arguments: toolArguments(c.args), ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}) })), usage, ...(nativeContent.length ? { providerData: { protocol, content: nativeContent.filter(Boolean) } } : {}) };
}

export async function discoverModels(c: AIConnection, key: string) {
  const headers: Record<string, string> = {};
  if (c.protocol === "anthropic") { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
  else if (c.protocol === "gemini") { if (key) headers["x-goog-api-key"] = key; }
  else if (key) headers.Authorization = `Bearer ${key}`;
  const response = await jsonResponse(await fetch(serviceUrl(c.baseUrl, "/models"), { headers, signal: AbortSignal.timeout(20000), redirect: "error" }));
  const result = await response.json() as any;
  return (result.data || result.models || []).slice(0, 2000).map((m: any) => ({ id: String(m.id || m.name).replace(/^models\//, ""), name: String(m.display_name || m.displayName || m.id || m.name) }));
}
