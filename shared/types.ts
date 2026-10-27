export type Scope = "page" | "nearby" | "full";
export type Rect = [number, number, number, number];
export type TurnState =
  | "preparing"
  | "generating"
  | "completed"
  | "stopped"
  | "failed"
  | "unknown";
export interface Document {
  id: string;
  name: string;
  pages: number;
  indexedPages: number;
  indexStatus: "indexing" | "ready" | "failed";
  indexError?: string;
  page: number;
  rotation: number;
  zoom: number;
  fitMode?: "page" | "width" | "custom";
  sourceFormat?: "pdf" | "ppt" | "pptx";
  importEngine?: "pdf" | "powerpoint" | "libreoffice";
  createdAt: string;
  hiddenRecent?: boolean;
  openedAt?: string;
}
export type ImportEngine = "powerpoint" | "libreoffice";
export interface ImportJob {
  id: string;
  name: string;
  hash: string;
  format: "pdf" | "ppt" | "pptx";
  state: "queued" | "processing" | "completed" | "failed" | "cancelled";
  engine?: ImportEngine | "pdf";
  documentId?: string;
  error?: string;
  createdAt: string;
}
export interface Conversation {
  id: string;
  documentId: string;
  title: string;
  threadId?: string;
  model?: string;
  createdAt: string;
  resumeError?: string;
  updatedAt?: string;
  pinned?: boolean;
  archived?: boolean;
  titleEdited?: boolean;
  parentConversationId?: string;
  branchTurnId?: string;
  courseId?: string;
  documentName?: string;
  seedContextId?: string;
  connectionId?: string;
  runtimeBindings?: Record<string, { threadId: string; model: string; throughTurnId?: string }>;
}
export type AnswerLength = "short" | "standard" | "detailed";
export interface AIModel {
  model: string;
  displayName: string;
  description?: string;
  isDefault: boolean;
  inputModalities?: string[];
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  connectionId?: string;
  connectionName?: string;
  capabilities?: { vision: boolean | "unknown"; tools: boolean | "unknown"; reasoning: boolean | "unknown" };
  contextWindow?: number;
  custom?: boolean;
  favorite?: boolean;
}
export interface ToolActivity {
  id: string;
  kind: "course" | "web" | "notes" | "artifact" | "external";
  title: string;
  detail: string;
  state: "running" | "completed" | "failed";
  durationMs?: number;
  urls?: string[];
  links?: { title: string; url: string }[];
}
export interface QuestionSnapshot {
  documentId: string;
  conversationId: string;
  page: number;
  rotation: number;
  selectedText: string;
  rect?: Rect;
  scope: Scope;
  extraPages: number[];
  images: string[];
  sources: Source[];
  answerLength?: AnswerLength;
  replyTurnId?: string;
  model?: string;
  reasoningEffort?: string;
  agentTools?: boolean;
  webSearch?: boolean;
  courseId?: string;
  documentIds?: string[];
  knowledgeRevisionId?: string;
  contextSnapshotId?: string;
  selections?: SelectionRef[];
  knowledgeSnapshot?: KnowledgeSnapshot;
  noteSnapshot?: LearningNote[];
  connectionId?: string;
  assistantId?: string;
  textOnly?: boolean;
  assistantSnapshot?: import("./ai.ts").AssistantProfile;
  aiContext?: import("./ai.ts").AIContext;
}
export interface Source {
  id: string;
  documentId: string;
  page: number;
  text: string;
  image?: boolean;
  documentName?: string;
  rect?: Rect;
  rects?: Rect[];
  deleted?: boolean;
}
export interface Turn {
  id: string;
  conversationId: string;
  question: string;
  snapshot: QuestionSnapshot;
  answer: string;
  state: TurnState;
  error?: string;
  threadTurnId?: string;
  runtimeThreadId?: string;
  createdAt: string;
  requestId?: string;
  originTurnId?: string;
  model?: string;
  reasoningEffort?: string;
  tools?: ToolActivity[];
  toolSources?: Source[];
  tokenUsage?: { input: number; output: number; total: number };
  readingSessionId?: string;
  connectionId?: string;
  connectionName?: string;
  switchedModel?: boolean;
  durationMs?: number;
}

export interface SelectionRef {
  id: string;
  kind: "rectangle" | "text" | "answer";
  documentId: string;
  documentName?: string;
  page: number;
  rotation: number;
  rect?: Rect;
  rects?: Rect[];
  text: string;
  image?: string;
  turnId?: string;
  deleted?: boolean;
}
export type AISettings = Pick<
  QuestionSnapshot,
  "model" | "reasoningEffort" | "webSearch" | "agentTools" | "connectionId" | "assistantId" | "textOnly" | "assistantSnapshot"
>;
export interface CourseFile {
  path: string;
  hash: string;
  size: number;
  modifiedAt: number;
  documentId?: string;
  selected: boolean;
  importJobId?: string;
}
export interface DirectoryChange {
  path: string;
  type: "added" | "modified" | "moved" | "deleted";
  from?: string;
  hash?: string;
  size?: number;
  modifiedAt?: number;
}
export interface Course {
  id: string;
  name: string;
  root?: string;
  files: CourseFile[];
  documentIds: string[];
  selectedDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
  changes: DirectoryChange[];
  scanId?: string;
  checkedAt?: string;
  offline?: string;
  knowledgeRevisionId?: string;
  knowledgeStale?: boolean;
  groups?: { id: string; name: string; documentIds: string[] }[];
  displayNames?: Record<string, string>;
  readingPosition?: { documentId: string; page: number; updatedAt: string };
  demo?: boolean;
}
export type ChapterState = "queued" | "reading" | "summarizing" | "completed" | "partial" | "failed" | "paused";
export interface KnowledgeChapter {
  documentId: string;
  summary: string;
  state?: ChapterState;
  completed?: number;
  failed?: number;
  total?: number;
  sources?: Source[];
  updatedAt?: string;
  error?: string;
  summaryCompleted?: number;
}
export interface KnowledgeSnapshot {
  capturedAt: string;
  summary: string;
  chapters: { documentId: string; title: string; summary: string }[];
  sources: Source[];
  completed: number;
  total: number;
}
export interface KnowledgePage {
  documentId: string;
  page: number;
  state: "completed" | "failed";
  summary?: string;
  error?: string;
  sources: Source[];
}
export interface KnowledgeRevision {
  id: string;
  courseId: string;
  documentIds: string[];
  state: "building" | "paused" | "completed" | "partial" | "failed";
  pages: KnowledgePage[];
  total: number;
  chapters: KnowledgeChapter[];
  summary: string;
  summaryUpdatedAt?: string;
  error?: string;
  createdAt: string;
  settings: AISettings;
  courseDocumentIds?: string[];
  mode?: "chapters" | "course" | "overview";
  force?: boolean;
  cacheVersion?: string;
  phase?: "reading" | "chapter" | "overview";
  activeDocumentId?: string;
  resultVersion?: number;
  updatedAt?: string;
  reused?: number;
  reduction?: { key: string; chunks: string[]; next: string[]; offset: number };
}
export interface ContextSnapshot {
  id: string;
  courseId?: string;
  documentIds: string[];
  knowledgeRevisionId?: string;
  conversationId?: string;
  title: string;
  turns: Turn[];
  notes?: LearningNote[];
  knowledgeSnapshot?: KnowledgeSnapshot;
  createdAt: string;
}
export interface ReadingSession {
  id: string;
  parentId?: string;
  parentTitle?: string;
  contextId: string;
  contextTitle?: string;
  sourceCount?: number;
  selection: SelectionRef;
  settings: AISettings;
  title: string;
  draft: string;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
    minimized: boolean;
  };
  createdAt: string;
}
export interface LearningNote {
  id: string;
  courseId?: string;
  documentId?: string;
  title: string;
  text: string;
  sources: Source[];
  createdAt: string;
  updatedAt?: string;
  version?: number;
  deletedAt?: string;
  originTurnId?: string;
  originKind?: "turn" | "readingTurn";
  anchor?: SelectionRef;
}
export const activeStates: TurnState[] = ["preparing", "generating"];
export const stateLabels: Record<TurnState, string> = {
  preparing: "准备上下文",
  generating: "生成中",
  completed: "完成",
  stopped: "已停止",
  failed: "失败",
  unknown: "结果未确认",
};
