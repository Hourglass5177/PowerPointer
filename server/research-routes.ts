import type { Express } from "express";
import type { EventEmitter } from "node:events";
import { z } from "zod";
import { ResearchService } from "./ai-research.ts";
import { ExternalServices } from "./ai-external.ts";
import { ArtifactStore } from "./ai-artifacts.ts";
import { NotesService } from "./notes.ts";
import type { LearningNote } from "../shared/types.ts";
import { portableAnswer } from "../shared/chat.ts";

export function researchRoutes(app: Express, research: ResearchService, external: ExternalServices, artifacts: ArtifactStore, events: EventEmitter) {
  app.get("/api/research", (req, res) => res.json(research.list(req.query.courseId ? String(req.query.courseId) : undefined, req.query.documentId ? String(req.query.documentId) : undefined).map(({ messages, context, answer, ...r }) => ({ ...r, answer: answer.slice(0, 250) }))));
  app.post("/api/research", async (req, res) => res.json(await research.create(req.body)));
  app.get("/api/research/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Connection", "keep-alive"); res.flushHeaders();
    const send = () => res.write(`data: ${JSON.stringify(research.progress())}\n\n`); send(); events.on("research", send);
    const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => { clearInterval(timer); events.off("research", send); });
  });
  app.get("/api/research/:id", (req, res) => res.json(research.get(String(req.params.id))));
  app.post("/api/research/:id/stop", (req, res) => res.json(research.stop(String(req.params.id))));
  app.post("/api/research/:id/pause", (req, res) => res.json(research.stop(String(req.params.id), true)));
  app.post("/api/research/:id/resume", (req, res) => res.json(research.resume(String(req.params.id), z.object({ message: z.string().max(12000).optional() }).parse(req.body || {}))));
  app.post("/api/research/:id/adopt", (req, res) => { const { index } = z.object({ index: z.number().int().min(0).max(1).default(0) }).parse(req.body || {}); res.json(research.adopt(String(req.params.id), index)); });
  app.get("/api/artifacts", (req, res) => res.json(artifacts.list(req.query.courseId ? String(req.query.courseId) : undefined, req.query.documentId ? String(req.query.documentId) : undefined, req.query.deleted === "true")));
  app.get("/api/artifacts/:id", (req, res) => res.json(artifacts.get(String(req.params.id))));
  app.post("/api/artifacts/:id/copy", (req, res) => { const a = artifacts.get(String(req.params.id)); const input = z.object({ title: z.string().trim().min(1).max(200), text: z.string().max(200000) }).parse(req.body); res.json(artifacts.create({ runId: a.runId, courseId: a.courseId, documentId: a.documentId, kind: a.kind, sources: a.sources, ...input })); });
  app.patch("/api/artifacts/:id", (req, res) => res.json(artifacts.edit(String(req.params.id), z.object({ version: z.number().int().positive(), title: z.string().trim().min(1).max(200).optional(), text: z.string().max(200000).optional() }).parse(req.body))));
  app.delete("/api/artifacts/:id", (req, res) => res.json(artifacts.remove(String(req.params.id))));
  app.post("/api/artifacts/:id/restore", (req, res) => res.json(artifacts.remove(String(req.params.id), true)));
  app.get("/api/artifacts/:id/versions", (req, res) => res.json(artifacts.versions(String(req.params.id))));
  app.post("/api/artifacts/:id/revert", (req, res) => { const b = z.object({ version: z.number().int().positive(), expectedVersion: z.number().int().positive() }).parse(req.body); res.json(artifacts.revert(String(req.params.id), b.version, b.expectedVersion)); });
  app.get("/api/artifacts/:id/export", (req, res) => { const a = artifacts.get(String(req.params.id)); res.setHeader("Content-Disposition", `attachment; filename="research.md"; filename*=UTF-8''${encodeURIComponent(a.title.replace(/[\\/:*?"<>|]/g, "_") + ".md")}`); res.type("text/markdown; charset=utf-8").send(`# ${a.title}\n\n${portableAnswer(a.text, new Map(a.sources.map(s => [s.id, s])), "课件")}\n`); });
  app.get("/api/notes/:id/versions", (req, res) => {
    const current = new NotesService(research.config.store, research.config.notify).get(String(req.params.id));
    res.json([...research.config.store.all<LearningNote & { noteId: string }>("noteVersion").filter(n => n.noteId === current.id), current].sort((a, b) => (b.version || 1) - (a.version || 1)));
  });
  app.post("/api/notes/:id/revert", (req, res) => {
    const id = String(req.params.id), b = z.object({ version: z.number().int().positive(), expectedVersion: z.number().int().positive() }).parse(req.body);
    const previous = research.config.store.get<LearningNote>("noteVersion", `${id}:${b.version}`); if (!previous) throw Error("笔记历史版本不存在");
    res.json(new NotesService(research.config.store, research.config.notify).edit(id, { title: previous.title, text: previous.text, sources: previous.sources, version: b.expectedVersion }));
  });
  app.get("/api/ai/tools", (_req, res) => res.json({ web: external.web(), mcp: external.list() }));
  app.put("/api/ai/tools/web", async (req, res) => res.json(await external.saveWeb(req.body)));
  app.post("/api/ai/tools/web/check", async (_req, res) => res.json(await external.search("Brave Search API", AbortSignal.timeout(30000))));
  app.post("/api/ai/tools/mcp", async (req, res) => res.json(await external.save(undefined, req.body)));
  app.put("/api/ai/tools/mcp/:id", async (req, res) => res.json(await external.save(String(req.params.id), req.body)));
  app.post("/api/ai/tools/mcp/:id/discover", async (req, res) => res.json(await external.discover(String(req.params.id))));
  app.delete("/api/ai/tools/mcp/:id", (req, res) => { external.remove(String(req.params.id)); res.json({ ok: true }); });
}
