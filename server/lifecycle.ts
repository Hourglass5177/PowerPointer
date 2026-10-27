import { readdirSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { Codex } from "./codex.ts";
import type {
  ContextSnapshot,
  Conversation,
  Course,
  Document,
  ImportJob,
  KnowledgeRevision,
  ReadingSession,
  Turn,
} from "../shared/types.ts";

export class Lifecycle {
  private cleaning = new Set<string>();
  private cleanupWork?: Promise<
    { id: string; ownerId: string; error?: string }[]
  >;
  constructor(
    private store: Store,
    private ai: Codex,
    private abort: (id: string) => void,
    private notify: () => void,
  ) {
    for (const c of store.all<Conversation>("conversation"))
      if (c.threadId && !store.get("ownedThread", c.threadId))
        this.own(c.threadId, c.id);
  }
  own(threadId: string, ownerId: string) {
    this.store.put("ownedThread", { id: threadId, ownerId });
  }
  impactDocument(id: string) {
    const d = this.store.document(id);
    if (!d) throw Error("课件不存在");
    return {
      name: d.name,
      conversations: this.store
        .all<Conversation>("conversation")
        .filter((c) => c.documentId === id).length,
      windows: this.store
        .all<ReadingSession>("reading")
        .filter((s) => s.selection.documentId === id).length,
      referencedConversations: new Set(
        this.store
          .all<Turn>("turn")
          .filter((t) =>
            [...t.snapshot.sources, ...(t.toolSources || [])].some(
              (source) => source.documentId === id,
            ),
          )
          .map((t) => t.conversationId),
      ).size,
      courses: this.store
        .all<Course>("course")
        .filter((c) => c.documentIds.includes(id))
        .map((c) => c.name),
      originalFilesUntouched: true,
    };
  }
  impactConversation(id: string) {
    const c = this.store.conversation(id);
    if (!c) throw Error("会话不存在");
    return {
      title: c.title,
      turns: this.store.all<Turn>("turn").filter((t) => t.conversationId === id)
        .length,
      branches: this.store
        .all<Conversation>("conversation")
        .filter((x) => x.parentConversationId === id).length,
    };
  }
  deleteConversation(id: string) {
    const c = this.store.conversation(id);
    if (!c) return { deleted: true };
    const turns = this.store
        .all<Turn>("turn")
        .filter((t) => t.conversationId === id),
      ids = new Set(turns.map((t) => t.id));
    this.store.transaction(() => {
      this.store.remove("conversation", id);
      for (const t of turns) {
        this.abort(t.id);
        this.store.remove("turn", t.id);
      }
      for (const r of this.store.all<{ id: string; turnId?: string }>(
        "chatRequest",
      ))
        if (r.turnId && ids.has(r.turnId))
          this.store.remove("chatRequest", r.id);
      for (const r of this.store.all<{ id: string; conversationId: string }>(
        "selection",
      ))
        if (r.conversationId === id) this.store.remove("selection", r.id);
      if (c.threadId) this.own(c.threadId, c.id);
    });
    this.collect();
    this.notify();
    void this.cleanupThreads();
    return { deleted: true };
  }
  deleteDocument(
    id: string,
    removeChats: boolean,
    closeWindow: (id: string) => void,
    cancelKnowledge: (id: string) => void,
  ) {
    const d = this.store.document(id);
    if (!d) return { deleted: true };
    for (const t of [
      ...this.store.all<Turn>("turn"),
      ...this.store.all<Turn>("readingTurn"),
    ])
      if (t.snapshot.documentId === id || t.snapshot.documentIds?.includes(id))
        this.abort(t.id);
    for (const r of this.store.all<KnowledgeRevision>("knowledge"))
      if (r.documentIds.includes(id)) {
        if (r.state === "building") cancelKnowledge(r.id);
      }
    if (removeChats) {
      for (const c of this.store.all<Conversation>("conversation"))
        if (c.documentId === id) this.deleteConversation(c.id);
      for (const s of this.store.all<ReadingSession>("reading"))
        if (s.selection.documentId === id) closeWindow(s.id);
    }
    this.store.transaction(() => {
      this.store.put("deletedDocument", {
        id,
        name: d.name,
        pages: d.pages,
        deletedAt: new Date().toISOString(),
      });
      this.store.remove("document", id);
      this.store.removePages(id);
      for (const c of this.store.all<Course>("course"))
        if (c.documentIds.includes(id))
          this.store.put("course", {
            ...c,
            documentIds: c.documentIds.filter((x) => x !== id),
            selectedDocumentIds: c.selectedDocumentIds.filter((x) => x !== id),
            files: c.files.map((f) =>
              f.documentId === id
                ? { ...f, documentId: undefined, selected: false }
                : f,
            ),
            knowledgeStale: true,
          });
      for (const p of this.store.all<{ id: string; documentId: string }>(
        "knowledgePage",
      ))
        if (p.documentId === id) this.store.remove("knowledgePage", p.id);
      for (const job of this.store.all<ImportJob>("import"))
        if (job.hash === id) this.store.remove("import", job.id);
      // Preserve answers and sent evidence while making every old source explicitly unavailable.
      const mark = (value: any): void => {
        if (!value || typeof value !== "object") return;
        if (
          value.documentId === id &&
          typeof value.page === "number" &&
          typeof value.text === "string"
        ) {
          value.deleted = true;
          value.documentName ||= d.name;
        }
        for (const child of Object.values(value))
          if (child && typeof child === "object") mark(child);
      };
      for (const kind of ["turn", "readingTurn", "context", "note", "knowledge"])
        for (const record of this.store.all<{ id: string }>(kind)) {
          mark(record);
          this.store.put(kind, record);
        }
      for (const c of this.store.all<Conversation>("conversation"))
        if (c.documentId === id)
          this.store.put("conversation", { ...c, documentName: d.name });
    });
    // Only content-addressed copies under this application's data folders are removed.
    for (const [folder, name] of [
      ["pdfs", `${id}.pdf`],
      ...["pdf", "ppt", "pptx"].map((ext) => ["originals", `${id}.${ext}`]),
    ]) {
      const file = path.join(this.store.dir, folder, name);
      if (existsSync(file))
        try {
          unlinkSync(file);
        } catch (e) {
          this.store.put("fileCleanup", {
            id: randomUUID(),
            folder,
            name,
            error: (e as Error).message,
          });
        }
    }
    this.collect();
    this.notify();
    return { deleted: true };
  }
  collect() {
    const turns = [
      ...this.store.all<Turn>("turn"),
      ...this.store.all<Turn>("readingTurn"),
    ];
    const readings = this.store.all<ReadingSession>("reading");
    const contexts = new Set(
      [
        ...readings.map((s) => s.contextId),
        ...this.store
          .all<Conversation>("conversation")
          .map((c) => c.seedContextId),
        ...turns.map((t) => t.snapshot.contextSnapshotId),
      ].filter(Boolean),
    );
    for (const c of this.store.all<ContextSnapshot>("context"))
      if (!contexts.has(c.id)) this.store.remove("context", c.id);
    const images = new Set<string>();
    const activePrefixes = turns
      .filter((t) => ["preparing", "generating"].includes(t.state))
      .map((t) => t.id + "-");
    const visit = (value: unknown) => {
      if (typeof value === "string" && /^[a-f0-9-]+-\d+\.png$/.test(value))
        images.add(value);
      else if (value && typeof value === "object")
        for (const v of Object.values(value)) visit(v);
    };
    visit(turns);
    visit(readings);
    visit(this.store.all("context"));
    visit(this.store.all("selection"));
    visit(this.store.all("note"));
    const folder = path.join(this.store.dir, "attachments");
    if (existsSync(folder))
      for (const name of readdirSync(folder))
        if (
          /^[a-f0-9-]+-\d+\.png$/.test(name) &&
          !images.has(name) &&
          !activePrefixes.some((p) => name.startsWith(p))
        ) {
          try {
            unlinkSync(path.join(folder, name));
          } catch {
            /* A running writer is collected again when its task ends. */
          }
        }
  }
  pendingCleanup() {
    return [
      ...this.store
        .all<{ id: string; ownerId: string; error?: string }>("ownedThread")
        .filter((r) => !this.store.conversation(r.ownerId)),
      ...this.store
        .all<{ id: string; error?: string }>("fileCleanup")
        .map((r) => ({ ...r, ownerId: "local-file" })),
    ];
  }
  cleanupThreads() {
    if (this.cleanupWork) return this.cleanupWork;
    this.cleanupWork = this.performCleanup().finally(() => {
      this.cleanupWork = undefined;
    });
    return this.cleanupWork;
  }
  private async performCleanup() {
    for (const r of this.store.all<{
      id: string;
      folder: string;
      name: string;
      error?: string;
    }>("fileCleanup")) {
      try {
        if (
          !["pdfs", "originals"].includes(r.folder) ||
          !/^[a-f0-9]{64}\.(pdf|ppt|pptx)$/.test(r.name)
        )
          throw Error("清理路径无效");
        const file = path.join(this.store.dir, r.folder, r.name);
        if (existsSync(file)) unlinkSync(file);
        this.store.remove("fileCleanup", r.id);
      } catch (e) {
        this.store.put("fileCleanup", { ...r, error: (e as Error).message });
      }
    }
    for (const r of this.pendingCleanup().filter(
      (r) => r.ownerId !== "local-file",
    )) {
      if (this.cleaning.has(r.id)) continue;
      this.cleaning.add(r.id);
      try {
        await this.ai.connect();
        await this.ai.rpc("thread/delete", { threadId: r.id });
        this.store.remove("ownedThread", r.id);
      } catch (e) {
        const error = (e as Error).message;
        if (/not found|does not exist|unknown thread/i.test(error))
          this.store.remove("ownedThread", r.id);
        else this.store.put("ownedThread", { ...r, error });
      } finally {
        this.cleaning.delete(r.id);
        this.notify();
      }
    }
    return this.pendingCleanup();
  }
}
