import type { AIModel, AISettings, SelectionRef, Source } from "./types.ts";

export const DEFAULT_CONNECTION = "codex";
export type AIProtocol = "codex" | "openai" | "compatible" | "anthropic" | "gemini";
export interface AIConnection {
  id: string;
  name: string;
  protocol: AIProtocol;
  preset?: string;
  baseUrl: string;
  enabled: boolean;
  models: AIModel[];
  defaultModel?: string;
  codexPath?: string;
  hasKey?: boolean;
  checkedAt?: string;
  status?: "ready" | "unconfigured" | "error";
  error?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ConnectionStatus {
  id: string;
  authenticated: boolean;
  error?: string;
  version?: string;
  plan?: string | null;
  limits?: { name: string; usedPercent: number; resetsAt?: number }[];
  limitMessage?: string;
}
export interface ModelRef { connectionId: string; modelId: string }
export type AssistantTool = "course" | "notes" | "web" | "artifacts";
export interface AssistantProfile {
  id: string;
  name: string;
  description: string;
  prompt: string;
  style: string;
  settings: AISettings;
  scope: "page" | "nearby" | "full";
  tools: AssistantTool[];
  mcpToolIds: string[];
  builtin?: boolean;
  updatedAt: string;
}
export interface AIUserPreferences {
  id: "preferences";
  defaultConnectionId: string;
  favorites: string[];
  recent: string[];
  names: Record<string, string>;
  profiles: Record<"quick" | "deep" | "batch", AISettings>;
}
export interface AIMemory {
  id: string;
  courseId?: string;
  kind: "preference" | "glossary" | "goal";
  title: string;
  text: string;
  updatedAt: string;
}
export interface AIContext {
  capturedAt: string;
  documentIds: string[];
  sources: Source[];
  notes: { id: string; title: string; text: string }[];
  memories: AIMemory[];
  history: { id: string; question: string; answer: string }[];
  compressed: boolean;
}
export interface AIUsage {
  id: string;
  connectionId: string;
  model: string;
  taskId?: string;
  taskKind: "chat" | "reading" | "knowledge" | "research" | "comparison" | "test";
  input?: number;
  output?: number;
  total?: number;
  durationMs: number;
  state: "completed" | "failed" | "stopped";
  error?: string;
  createdAt: string;
}
export interface AgentStep {
  id: string;
  title: string;
  detail?: string;
  state: "running" | "completed" | "failed";
  tool?: string;
  createdAt: string;
}
export interface ResearchMessage {
  role: "user" | "assistant" | "tool";
  text: string;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown>; thoughtSignature?: string }[];
  toolCallId?: string;
  images?: string[];
  providerData?: { protocol: string; content: any[] };
}
export interface ResearchRun {
  id: string;
  courseId?: string;
  documentId: string;
  title: string;
  goal: string;
  page: number;
  scope: "page" | "nearby" | "full";
  settings: AISettings;
  assistant: AssistantProfile;
  context: AIContext;
  selection?: SelectionRef;
  state: "queued" | "running" | "paused" | "completed" | "failed" | "stopped" | "unknown";
  mode: "research" | "compare" | "review";
  compareSettings?: AISettings;
  comparison?: { settings: AISettings; answer: string; sources: Source[]; state: string; error?: string }[];
  steps: AgentStep[];
  messages: ResearchMessage[];
  answer: string;
  sources: Source[];
  artifactIds: string[];
  calls: number;
  callLimit: number;
  elapsedMs: number;
  startedAt?: string;
  timeLimitMs: number;
  checkpoint?: string;
  error?: string;
  pendingTool?: { id: string; name: string; arguments: Record<string, unknown> };
  pauseRequested?: boolean;
  webSources?: { url: string; title: string; text: string }[];
  searchService?: string;
  citationWarnings?: string[];
  createdAt: string;
  updatedAt: string;
}
export interface ResearchArtifact {
  id: string;
  runId: string;
  courseId?: string;
  documentId: string;
  title: string;
  kind: "report" | "table" | "outline" | "quiz";
  text: string;
  sources: Source[];
  version: number;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ArtifactVersion extends Omit<ResearchArtifact, "id"> { id: string; artifactId: string }
export interface ExternalTool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  readOnly: boolean;
}
export interface MCPConnection {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasKey?: boolean;
  tools: ExternalTool[];
  checkedAt?: string;
  error?: string;
}
type EffortModel = Pick<AIModel, "defaultReasoningEffort" | "supportedReasoningEfforts" | "capabilities">;
// The configured default is always selectable; it must not be rejected for missing from the list.
export function modelEfforts(model?: EffortModel) {
  if (!model || model.capabilities?.reasoning === false) return [];
  return [...new Set([...model.supportedReasoningEfforts.map(e => e.reasoningEffort.trim()), model.defaultReasoningEffort?.trim()])].filter(Boolean) as string[];
}
export function defaultEffort(model?: EffortModel) {
  const effort = model?.defaultReasoningEffort?.trim() || "";
  return modelEfforts(model).includes(effort) ? effort : "";
}
export const connectionPresets: { id: string; name: string; protocol: AIProtocol; baseUrl: string; reasoningEfforts?: string[]; defaultReasoningEffort?: string }[] = [
  { id: "openai", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { id: "gemini", name: "Gemini", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "deepseek", name: "DeepSeek", protocol: "compatible", baseUrl: "https://api.deepseek.com/v1", reasoningEfforts: ["low", "high", "max"], defaultReasoningEffort: "high" },
  { id: "qwen", name: "通义千问", protocol: "compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "openrouter", name: "OpenRouter", protocol: "compatible", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "ollama", name: "Ollama", protocol: "compatible", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", name: "LM Studio", protocol: "compatible", baseUrl: "http://127.0.0.1:1234/v1" },
  { id: "custom", name: "自定义服务", protocol: "compatible", baseUrl: "" },
];
// A confirmed reasoning model with no list of its own uses the service's documented efforts.
export function withPresetEfforts<T extends AIConnection>(connection: T): T {
  const preset = connectionPresets.find(p => p.id === connection.preset);
  if (!preset?.reasoningEfforts) return connection;
  return { ...connection, models: connection.models.map(m => m.capabilities?.reasoning === true && !m.supportedReasoningEfforts.length ? { ...m, supportedReasoningEfforts: preset.reasoningEfforts!.map(reasoningEffort => ({ reasoningEffort, description: "" })), defaultReasoningEffort: m.defaultReasoningEffort || preset.defaultReasoningEffort || "" } : m) };
}
export const modelKey = (connectionId: string | undefined, model: string) => `${connectionId || DEFAULT_CONNECTION}::${model}`;
export const profileLabels = { quick: "快速解释", deep: "深入分析", batch: "批量整理" };
export function builtinAssistants(): AssistantProfile[] {
  return [
    ["explain", "课程讲解", "把概念讲清楚，联系原文与例子。", "先直接回答，再按需要补充解释和一个恰当例子。区分原文与补充，不机械套用长篇模板。"],
    ["verify", "推导核查", "检查条件、步骤和结论的依据。", "核对前提、符号、每一步推导及适用范围。指出缺失条件和反例；没有充分依据时明确未确认。"],
    ["research", "跨资料研究", "比较资料、核对来源，形成研究成果。", "把目标拆成必要子问题，使用不同关键词查阅相关资料及邻页，比较观点和证据，形成有来源的研究成果。"],
    ["practice", "复习出题", "根据已选资料出题，帮助主动回忆。", "围绕资料中的核心概念与易错点设计题目，标注依据。先呈现题目，再给参考答案与解释，避免只考记忆。"],
  ].map(([id, name, description, prompt]) => ({ id, name, description, prompt, style: "中文，简洁清楚；公式使用 LaTeX，引用真实来源。", settings: {}, scope: "full", tools: ["course", "notes", "web", "artifacts"], mcpToolIds: [], builtin: true, updatedAt: "2026-10-23T00:00:00.000Z" }));
}
