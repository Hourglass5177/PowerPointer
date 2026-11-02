import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Store } from "./store.ts";
import type { CourseService } from "./courses.ts";
import type { ReadingService } from "./reading.ts";
import type { KnowledgeService } from "./knowledge.ts";
import type { Lifecycle } from "./lifecycle.ts";
import type { MindMapService, MindMapTarget } from "./mind-maps.ts";
import { NotesService, type NoteInput } from "./notes.ts";
import {
  type Conversation,
  type SelectionRef,
  type Turn,
  type AISettings,
} from "../shared/types.ts";

const id = z.string().uuid(),
  documentId = z.string().regex(/^[a-f0-9]{64}$/);
const rect = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
export const aiSettingsSchema = z.object({
  connectionId: z.string().max(100).optional(),
  assistantId: z.string().max(100).optional(),
  textOnly: z.boolean().optional(),
  model: z.string().max(100).optional(),
  reasoningEffort: z.string().max(30).optional(),
  agentTools: z.boolean().optional(),
  webSearch: z.boolean().optional(),
});
export const selectionSchema = z.object({
  id,
  kind: z.enum(["rectangle", "text", "answer"]),
  documentId,
  documentName: z.string().max(300).optional(),
  page: z.number().int().positive(),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  rect: z
    .tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ])
    .optional(),
  text: z.string().max(12000),
  rects: z.array(rect).max(300).optional(),
  image: z
    .string()
    .regex(/^[a-f0-9-]+-\d+\.png$/)
    .optional(),
  turnId: id.optional(),
});
const layoutSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(280).max(1800),
  height: z.number().min(180).max(1400),
  minimized: z.boolean(),
});
export function powerRoutes(
  app: Express,
  services: {
    store: Store;
    courses: CourseService;
    reading: ReadingService;
    knowledge: KnowledgeService;
    mindMaps: MindMapService;
    lifecycle: Lifecycle;
    resolveSettings?: (settings: AISettings, vision?: boolean) => Promise<AISettings>;
    render: (
      id: string,
      page: number,
      rotation: number,
      rect?: [number, number, number, number],
    ) => Promise<Buffer>;
    notify: () => void;
  },
) {
  const { store, courses, reading, knowledge, mindMaps, lifecycle, render, notify } =
    services;
  const notes = new NotesService(store, notify);
  const noteSchema = z.object({ id: id.optional(), courseId: id.optional(), documentId: documentId.optional(), title: z.string().max(200).optional(), text: z.string().max(200000).optional(), anchor: selectionSchema.optional(), turnId: id.optional(), originKind: z.enum(["turn", "readingTurn"]).optional() });
  const mindMapTargetSchema = z.object({
    scope: z.enum(["course", "document"]),
    courseId: id.optional(),
    documentId: documentId.optional(),
  }).superRefine((value, context) => {
    if (value.scope === "course" && (!value.courseId || value.documentId))
      context.addIssue({ code: "custom", message: "课程导图范围无效" });
    if (value.scope === "document" && !value.documentId)
      context.addIssue({ code: "custom", message: "请选择课件" });
  });
  const mindMapNodeSchema = z.object({
    id,
    parentId: id.optional(),
    text: z.string().trim().min(1).max(160),
    summary: z.string().max(1200).optional(),
    note: z.string().max(4000).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    collapsed: z.boolean().optional(),
    x: z.number().finite().min(-1000000).max(1000000).optional(),
    y: z.number().finite().min(-1000000).max(1000000).optional(),
    side: z.enum(["left", "right"]).optional(),
    source: z.object({ documentId, documentName: z.string().max(300).optional(), page: z.number().int().positive() }).optional(),
    link: z.string().trim().max(2000).refine(value => !value || /^https?:\/\//i.test(value), "链接必须使用 http 或 https").optional(),
  });
  const createNote = async (input: NoteInput) => {
    const anchor = input.anchor;
    if (input.turnId || anchor?.kind !== "rectangle" || (input.id && store.get("note", input.id))) return notes.create(input);
    const image = `${randomUUID()}-0.png`;
    const file = path.join(store.dir, "attachments", image);
    try {
      await writeFile(file, await render(anchor.documentId, anchor.page, anchor.rotation, anchor.rect));
      return notes.create(input, image);
    } catch (error) {
      await unlink(file).catch(() => {});
      throw error;
    }
  };
  app.post("/api/documents/:id/recent", (req, res) => {
    const d = store.document(req.params.id);
    if (!d) throw Error("课件不存在");
    const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body);
    res.json(
      store.put("document", {
        ...d,
        hiddenRecent: hidden,
        ...(!hidden ? { openedAt: new Date().toISOString() } : {}),
      }),
    );
  });
  app.get("/api/documents/:id/impact", (req, res) =>
    res.json(lifecycle.impactDocument(req.params.id)),
  );
  app.delete("/api/documents/:id", (req, res) => {
    const { deleteChats = false } = z
      .object({ deleteChats: z.boolean().optional() })
      .parse(req.body || {});
    res.json(
      lifecycle.deleteDocument(
        req.params.id,
        deleteChats,
        (id) => reading.close(id),
        (id) => knowledge.cancel(id),
      ),
    );
  });
  app.get("/api/conversations/:id/impact", (req, res) =>
    res.json(lifecycle.impactConversation(req.params.id)),
  );
  app.delete("/api/conversations/:id", (req, res) =>
    res.json(lifecycle.deleteConversation(req.params.id)),
  );
  app.get("/api/conversations", (req, res) => {
    const courseId = String(req.query.courseId || ""),
      doc = String(req.query.documentId || ""),
      query = String(req.query.q || "")
        .slice(0, 200)
        .toLocaleLowerCase();
    res.json(
      store
        .all<Conversation>("conversation")
        .filter(
          (c) =>
            (!courseId || c.courseId === courseId) &&
            (!doc || c.documentId === doc) &&
            (!query ||
              c.title.toLocaleLowerCase().includes(query) ||
              store
                .all<Turn>("turn")
                .some(
                  (t) =>
                    t.conversationId === c.id &&
                    (t.question + "\n" + t.answer)
                      .toLocaleLowerCase()
                      .includes(query),
                )),
        ),
    );
  });
  app.get("/api/deleted-documents", (_req, res) =>
    res.json(store.all("deletedDocument")),
  );
  app.get("/api/cleanup", (_req, res) => res.json(lifecycle.pendingCleanup()));
  app.post("/api/cleanup/retry", async (_req, res) =>
    res.json(await lifecycle.cleanupThreads()),
  );
  app.get("/api/courses", (_req, res) => res.json(courses.list()));
  app.post("/api/courses", (req, res) => {
    const { name, documentIds } = z
      .object({
        name: z.string().trim().min(1).max(100),
        documentIds: z.array(documentId).max(2000).default([]),
      })
      .parse(req.body);
    res.json(courses.create(name, documentIds));
  });
  app.patch("/api/courses/:id", (req, res) =>
    res.json(
      courses.patch(
        req.params.id,
        z
          .object({
            name: z.string().trim().min(1).max(100).optional(),
            documentIds: z.array(documentId).max(2000).optional(),
            selectedDocumentIds: z.array(documentId).max(2000).optional(),
            groups: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100), documentIds: z.array(documentId).max(2000) })).max(100).optional(),
            displayNames: z.record(documentId, z.string().trim().min(1).max(200)).optional(),
            readingPosition: z.object({ documentId, page: z.number().int().positive(), updatedAt: z.string().optional().default("") }).optional(),
          })
          .parse(req.body),
      ),
    ),
  );
  const grants = new Map<string, { root: string; expires: number }>();
  let choosing = false;
  app.post("/api/folders/pick", async (_req, res) => {
    if (process.platform !== "win32")
      throw Error("目录选择器仅支持当前 Windows 桌面版");
    if (choosing) throw Error("目录选择器已打开");
    choosing = true;
    try {
      const root = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            fileURLToPath(new URL("./folder-picker.ps1", import.meta.url)),
          ],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "";
        child.stdout.on("data", (b) => (out += b.toString("utf8")));
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(out.trim())
            : reject(Error("无法打开目录选择器")),
        );
      });
      const grantId = root ? randomUUID() : undefined;
      if (grantId)
        grants.set(grantId, { root, expires: Date.now() + 15 * 60000 });
      res.json({ root, grantId });
    } finally {
      choosing = false;
    }
  });
  app.post("/api/courses/:id/bind", async (req, res) => {
    const { grantId } = z.object({ grantId: id }).parse(req.body),
      grant = grants.get(grantId);
    if (!grant || grant.expires < Date.now())
      throw Error("请使用目录选择器重新选择目录");
    res.json(await courses.bind(req.params.id, grant.root));
    grants.delete(grantId);
  });
  app.post("/api/courses/:id/unbind", (req, res) =>
    res.json(courses.unbind(req.params.id)),
  );
  app.post("/api/courses/:id/scan", async (req, res) =>
    res.json(await courses.scan(req.params.id)),
  );
  app.post("/api/courses/:id/sync", async (req, res) => {
    const b = z
      .object({
        scanId: z.string().min(1).max(100),
        paths: z.array(z.string().max(2000)).max(2000),
      })
      .parse(req.body);
    res.json(await courses.sync(req.params.id, b.scanId, b.paths));
  });
  app.post("/api/courses/:id/conversations", (req, res) => {
    const c = courses.get(req.params.id),
      d =
        z.object({ documentId: documentId.optional() }).parse(req.body || {})
          .documentId || c.selectedDocumentIds[0];
    if (!d || !c.documentIds.includes(d) || !store.document(d))
      throw Error("请先选择课程课件");
    res.json(
      store.put<Conversation>("conversation", {
        id: randomUUID(),
        documentId: d,
        documentName: store.document(d)?.name,
        courseId: c.id,
        title: "新会话",
        createdAt: new Date().toISOString(),
      }),
    );
  });
  app.get("/api/courses/:id/knowledge", (req, res) =>
    res.json(knowledge.list(req.params.id)),
  );
  app.post("/api/courses/:id/knowledge", async (req, res) => {
    const body = aiSettingsSchema.extend({ documentIds: z.array(documentId).min(1).max(2000).optional(), overviewOnly: z.boolean().optional(), force: z.boolean().optional() }).parse(req.body || {});
    const settings = services.resolveSettings ? await services.resolveSettings(aiSettingsSchema.parse(body)) : aiSettingsSchema.parse(body);
    res.json(knowledge.start(req.params.id, settings, body));
  });
  app.get("/api/mind-maps", (req, res) => {
    const target = mindMapTargetSchema.parse({
      scope: req.query.scope,
      courseId: req.query.courseId || undefined,
      documentId: req.query.documentId || undefined,
    }) as MindMapTarget;
    res.json(mindMaps.list(target));
  });
  app.post("/api/mind-maps", (req, res) => {
    const body = mindMapTargetSchema.safeExtend({
      title: z.string().trim().min(1).max(200).optional(),
      imported: z.object({ rootId: id, nodes: z.array(mindMapNodeSchema).min(1).max(300), layout: z.enum(["tree", "free"]), theme: z.enum(["paper", "colorful", "mono"]) }).optional(),
    }).parse(req.body);
    res.json(store.transaction(() => {
      const created = mindMaps.create(body, body.title);
      return body.imported ? mindMaps.update(created.id, created.version, body.imported) : created;
    }));
  });
  app.put("/api/mind-maps/:id", (req, res) => {
    const body = z.object({
      expectedVersion: z.number().int().positive(),
      rootId: id.optional(),
      title: z.string().trim().min(1).max(200).optional(),
      nodes: z.array(mindMapNodeSchema).min(1).max(300).optional(),
      layout: z.enum(["tree", "free"]).optional(),
      theme: z.enum(["paper", "colorful", "mono"]).optional(),
    }).parse(req.body);
    const { expectedVersion, ...patch } = body;
    res.json(mindMaps.update(req.params.id, expectedVersion, patch));
  });
  app.delete("/api/mind-maps/:id", (req, res) =>
    res.json(mindMaps.remove(req.params.id)),
  );
  app.post("/api/mind-maps/generate", async (req, res) => {
    const body = mindMapTargetSchema.safeExtend({
      mapId: id.optional(),
      expectedVersion: z.number().int().positive().optional(),
      focus: z.string().trim().max(500).optional(),
    }).and(aiSettingsSchema).parse(req.body || {});
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    const settingsInput = aiSettingsSchema.parse(body);
    const settings = services.resolveSettings
      ? await services.resolveSettings(settingsInput, false)
      : settingsInput;
    res.json(await mindMaps.generate({
      mapId: body.mapId,
      expectedVersion: body.expectedVersion,
      focus: body.focus,
      target: body,
      settings,
      signal: controller.signal,
    }));
  });
  app.post("/api/knowledge/:id/cancel", (req, res) =>
    res.json(knowledge.cancel(req.params.id)),
  );
  app.post("/api/knowledge/:id/resume", async (req, res) =>
    res.json(
      knowledge.resume(
        req.params.id,
        z
          .object({ retryFailed: z.boolean().default(false) })
          .parse(req.body || {}).retryFailed,
        services.resolveSettings ? await services.resolveSettings(knowledge.get(req.params.id).settings) : undefined,
      ),
    ),
  );
  app.get("/api/courses/:id/notes", (req, res) =>
    res.json(notes.list({ courseId: req.params.id, documentId: req.query.documentId ? String(req.query.documentId) : undefined, q: String(req.query.q || ""), deleted: req.query.deleted === "true" })),
  );
  app.post("/api/courses/:id/notes", async (req, res) => {
    courses.get(req.params.id);
    res.json(await createNote({ ...noteSchema.parse(req.body), courseId: req.params.id }));
  });
  app.get("/api/notes", (req, res) => res.json(notes.list({ courseId: req.query.courseId ? String(req.query.courseId) : undefined, documentId: req.query.documentId ? String(req.query.documentId) : undefined, q: String(req.query.q || ""), deleted: req.query.deleted === "true" })));
  app.post("/api/notes", async (req, res) => res.json(await createNote(noteSchema.parse(req.body))));
  app.patch("/api/notes/:id", (req, res) => res.json(notes.edit(req.params.id, z.object({ title: z.string().max(200).optional(), text: z.string().max(200000).optional(), version: z.number().int().positive() }).parse(req.body))));
  app.post("/api/notes/:id/restore", (req, res) => res.json(notes.restore(req.params.id)));
  app.delete("/api/notes/:id", (req, res) => {
    res.json(notes.remove(req.params.id));
  });
  app.post("/api/selections", async (req, res) => {
    const { selection, conversationId } = z
        .object({ selection: selectionSchema, conversationId: id })
        .parse(req.body),
      doc = store.document(selection.documentId),
      conv = store.conversation(conversationId);
    if (!doc || !conv) throw Error("来源课件或会话不存在");
    const previous = store.get<SelectionRef & { conversationId: string }>(
      "selection",
      selection.id,
    );
    if (previous) {
      if (previous.conversationId !== conversationId)
        throw Error("引用属于其他会话");
      res.json(previous);
      return;
    }
    if (selection.page > doc.pages) throw Error("页码无效");
    const image = `${selection.id}-0.png`;
    await writeFile(
      path.join(store.dir, "attachments", image),
      await render(doc.id, selection.page, selection.rotation, selection.rect),
    );
    if (!store.document(doc.id) || !store.conversation(conversationId)) {
      lifecycle.collect();
      throw Error("来源或会话已删除");
    }
    const saved = store.put("selection", {
      ...selection,
      documentName: doc.name,
      image,
      conversationId,
    });
    res.json(saved);
  });
  app.delete("/api/selections/:id", (req, res) => {
    store.remove("selection", req.params.id);
    lifecycle.collect();
    res.json({ deleted: true });
  });
  app.get("/api/reading", (_req, res) => res.json(reading.state()));
  app.post("/api/reading", (req, res) =>
    res.json(
      reading.create(
        z
          .object({
            id,
            parentId: id.optional(),
            conversationId: id.optional(),
            courseId: id.optional(),
            selection: selectionSchema,
            settings: aiSettingsSchema,
            layout: layoutSchema,
          })
          .parse(req.body),
      ),
    ),
  );
  app.patch("/api/reading/:id", (req, res) =>
    res.json(
      reading.patch(
        req.params.id,
        z
          .object({
            draft: z.string().max(6000).optional(),
            settings: aiSettingsSchema.optional(),
            layout: layoutSchema.optional(),
          })
          .parse(req.body),
      ),
    ),
  );
  app.post("/api/reading/:id/turns", (req, res) => {
    const b = z
      .object({ question: z.string().trim().min(1).max(6000), requestId: id })
      .parse(req.body);
    res.json(reading.ask(req.params.id, b.question, b.requestId));
  });
  app.delete("/api/reading/:id", (req, res) =>
    res.json(reading.close(req.params.id, req.query.branch === "true")),
  );
  app.post("/api/reading/:id/promote", (req, res) =>
    res.json(reading.promote(req.params.id)),
  );
}
