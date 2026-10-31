import { randomUUID } from "node:crypto";
import { z } from "zod";
import { builtinAssistants, defaultEffort, modelEfforts, modelKey, withPresetEfforts, type AIConnection, type AIUserPreferences, type AssistantProfile, type AIMemory, type AIUsage } from "../shared/ai.ts";
import type { AIModel, AISettings } from "../shared/types.ts";
import { Store } from "./store.ts";
import { Codex } from "./codex.ts";
import { SecretVault } from "./ai-vault.ts";
import { discoverModels, invokeProvider, serviceUrl } from "./ai-provider.ts";

export const settingsSchema = z.object({ connectionId: z.string().max(100).optional(), model: z.string().max(200).optional(), assistantId: z.string().max(100).optional(), reasoningEffort: z.string().max(30).optional(), agentTools: z.boolean().optional(), webSearch: z.boolean().optional(), textOnly: z.boolean().optional() });
const capability = z.union([z.boolean(), z.literal("unknown")]);
const modelSchema = z.object({ model: z.string().min(1).max(200), displayName: z.string().max(200), description: z.string().max(1000).optional(), isDefault: z.boolean().default(false), inputModalities: z.array(z.string()).optional(), defaultReasoningEffort: z.string().trim().max(30).default(""), supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string().trim().max(30), description: z.string().max(200) })).max(20).transform(list => list.filter(e => e.reasoningEffort)).default([]), capabilities: z.object({ vision: capability, tools: capability, reasoning: capability }).optional(), contextWindow: z.number().int().positive().optional(), custom: z.boolean().optional() });
const connectionSchema = z.object({ name: z.string().trim().min(1).max(100), protocol: z.enum(["codex", "openai", "compatible", "anthropic", "gemini"]), preset: z.string().max(100).optional(), baseUrl: z.string().max(2000), enabled: z.boolean(), models: z.array(modelSchema).max(2000), defaultModel: z.string().max(200).optional(), codexPath: z.string().max(2000).optional(), apiKey: z.string().max(8192).optional() });
const assistantSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(1000), prompt: z.string().max(20000), style: z.string().max(2000), settings: settingsSchema, scope: z.enum(["page", "nearby", "full"]), tools: z.array(z.enum(["course", "notes", "web", "artifacts"])).max(4), mcpToolIds: z.array(z.string().max(200)).max(100) });
export class AIConfig {
  readonly vault: SecretVault;
  constructor(readonly store: Store, readonly codex: Codex, readonly notify: () => void) {
    this.vault = new SecretVault(store);
    const now = new Date().toISOString();
    if (!store.get("aiConnection", "codex")) store.put("aiConnection", { id: "codex", name: "Codex 订阅", protocol: "codex", baseUrl: "", enabled: true, models: [], createdAt: now, updatedAt: now } satisfies AIConnection);
    const executable = store.get<AIConnection>("aiConnection", "codex")?.codexPath;
    if (executable) codex.useExecutable(executable);
    for (const assistant of builtinAssistants()) if (!store.get("aiAssistant", assistant.id)) store.put("aiAssistant", assistant);
  }
  connections() { return this.store.all<AIConnection>("aiConnection").map(c => ({ ...withPresetEfforts(c), hasKey: this.vault.has(c.id) })); }
  connection(id = "codex") { const c = this.connections().find(c => c.id === id); if (!c) throw Error("模型连接不存在"); return c; }
  async saveConnection(id: string | undefined, input: unknown) {
    const v = connectionSchema.parse(input), old = id ? this.connection(id) : undefined;
    if (v.protocol === "codex" && id !== "codex") throw Error("Codex 订阅使用内置连接");
    if (id === "codex" && v.protocol !== "codex") throw Error("不能更改内置连接的协议");
    if (v.protocol !== "codex") serviceUrl(v.baseUrl, "");
    const now = new Date().toISOString(), connectionId = id || randomUUID();
    if (v.apiKey !== undefined) await this.vault.set(connectionId, v.apiKey.trim());
    const { apiKey: _, ...fields } = v;
    const c: AIConnection = { ...fields, id: connectionId, createdAt: old?.createdAt || now, updatedAt: now };
    if (c.protocol === "codex") this.codex.useExecutable(c.codexPath || undefined);
    this.store.put("aiConnection", c); this.notify(); return this.connection(c.id);
  }
  removeConnection(id: string) { if (id === "codex") throw Error("内置连接可以关闭，但不能删除"); this.store.remove("aiConnection", id); this.vault.remove(id); const p = this.preferences(); if (p.defaultConnectionId === id) this.savePreferences({ ...p, defaultConnectionId: "codex" }); this.notify(); }
  async models(id?: string): Promise<AIModel[]> {
    const list = id ? [this.connection(id)] : this.connections().filter(c => c.enabled);
    const result = await Promise.all(list.map(async c => {
      let models = c.models;
      if (c.protocol === "codex") { try { models = await this.codex.models(); } catch { models = []; } }
      return models.map(m => ({ ...m, connectionId: c.id, connectionName: c.name, capabilities: m.capabilities || { vision: m.inputModalities?.includes("image") ?? "unknown", tools: c.protocol === "codex" ? true : "unknown", reasoning: m.supportedReasoningEfforts.length > 0 }, favorite: this.preferences().favorites.includes(modelKey(c.id, m.model)) }));
    }));
    return result.flat();
  }
  async check(id: string, testModel?: string) {
    const c = this.connection(id);
    const started = Date.now();
    try {
      if (c.protocol === "codex") {
        const status = await this.codex.status();
        let limits: unknown, limitMessage: string | undefined;
        try { limits = await this.codex.rateLimits(); } catch { limitMessage = "当前 CLI 未返回订阅额度，额度信息暂不可用"; }
        return { id, ...status, limits, limitMessage };
      }
      const key = await this.vault.get(id);
      if (testModel) {
        const start = Date.now();
        const r = await invokeProvider(c, key, { model: testModel, system: "Reply briefly.", messages: [{ role: "user", text: "Reply OK." }], signal: AbortSignal.timeout(45000) });
        if (!r.text.trim()) throw Error("连接返回了空回答");
        this.usage({ connectionId: id, model: testModel, taskKind: "test", durationMs: Date.now() - start, state: "completed", ...r.usage });
      } else {
        const found = await discoverModels(c, key);
        c.models = [...found.map((m: { id: string; name: string }) => c.models.find(x => x.model === m.id) || { model: m.id, displayName: m.name, isDefault: false, defaultReasoningEffort: "", supportedReasoningEfforts: [], capabilities: { vision: "unknown", tools: "unknown", reasoning: "unknown" } }), ...c.models.filter(m => m.custom && !found.some((f: { id: string }) => f.id === m.model))];
      }
      this.store.put("aiConnection", { ...c, checkedAt: new Date().toISOString(), status: "ready", error: undefined }); this.notify();
      return { id, authenticated: true, models: c.models };
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接失败";
      if (testModel && c.protocol !== "codex") this.usage({ connectionId: id, model: testModel, taskKind: "test", durationMs: Date.now() - started, state: "failed", error: message });
      this.store.put("aiConnection", { ...c, checkedAt: new Date().toISOString(), status: "error", error: message }); this.notify();
      throw Error(message);
    }
  }
  async resolve(settings: AISettings, requireVision = false) {
    const c = this.connection(settings.connectionId || this.preferences().defaultConnectionId);
    if (!c.enabled) throw Error("所选连接已关闭");
    const models = await this.models(c.id);
    const model = settings.model ? models.find(m => m.model === settings.model) : models.find(m => m.model === c.defaultModel) || models.find(m => m.isDefault) || models[0];
    if (!model) throw Error("此连接没有可用模型，请在 AI 连接中心获取模型或填写模型 ID");
    if (requireVision && model.capabilities?.vision !== true) throw Error("所选模型尚未确认支持图像。请选择图像模型，或明确改为仅文本问答。");
    const effort = settings.reasoningEffort || defaultEffort(model);
    if (effort && !modelEfforts(model).includes(effort)) throw Error("所选模型不支持此思考强度");
    return { connection: c, model, settings: { ...settings, connectionId: c.id, model: model.model, reasoningEffort: effort || undefined } };
  }
  assistants() { return this.store.all<AssistantProfile>("aiAssistant"); }
  assistant(id = "explain") { const a = this.store.get<AssistantProfile>("aiAssistant", id); if (!a) throw Error("助手不存在"); return structuredClone(a); }
  saveAssistant(id: string | undefined, input: unknown) { const a = assistantSchema.parse(input), existing = id && this.store.get<AssistantProfile>("aiAssistant", id); const result = this.store.put("aiAssistant", { ...a, id: id || randomUUID(), builtin: existing ? existing.builtin : undefined, updatedAt: new Date().toISOString() }); this.notify(); return result; }
  preferences(): AIUserPreferences { return this.store.get("aiPreference", "preferences") || { id: "preferences", defaultConnectionId: "codex", favorites: [], recent: [], names: {}, profiles: { quick: {}, deep: {}, batch: {} } }; }
  savePreferences(input: unknown) { const v = z.object({ defaultConnectionId: z.string().max(100), favorites: z.array(z.string().max(400)).max(200), recent: z.array(z.string().max(400)).max(40), names: z.record(z.string().max(400), z.string().max(100)), profiles: z.object({ quick: settingsSchema, deep: settingsSchema, batch: settingsSchema }) }).parse(input); this.connection(v.defaultConnectionId); const result = this.store.put("aiPreference", { ...v, id: "preferences" as const }); this.notify(); return result; }
  memories(courseId?: string) { return this.store.all<AIMemory>("aiMemory").filter(m => !m.courseId || m.courseId === courseId); }
  saveMemory(id: string | undefined, input: unknown) { const v = z.object({ courseId: z.string().uuid().optional(), kind: z.enum(["preference", "glossary", "goal"]), title: z.string().min(1).max(200), text: z.string().max(20000) }).parse(input); const result = this.store.put("aiMemory", { ...v, id: id || randomUUID(), updatedAt: new Date().toISOString() }); this.notify(); return result; }
  usage(value: Omit<AIUsage, "id" | "createdAt">) { this.store.put("aiUsage", { ...value, id: randomUUID(), createdAt: new Date().toISOString() }); }
}
