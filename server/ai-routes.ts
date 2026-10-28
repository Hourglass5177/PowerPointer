import type { Express } from "express";
import { z } from "zod";
import { AIConfig } from "./ai-config.ts";
import type { AIUsage, AIMemory } from "../shared/ai.ts";
import type { EventEmitter } from "node:events";

export function aiRoutes(app: Express, config: AIConfig, events: EventEmitter) {
  app.get("/api/ai/config", (_req, res) => res.json({ connections: config.connections(), assistants: config.assistants(), preferences: config.preferences() }));
  app.get("/api/ai/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Connection", "keep-alive"); res.flushHeaders();
    const send = () => res.write(`data: ${JSON.stringify({ changedAt: Date.now() })}\n\n`);
    send(); events.on("ai", send);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => { clearInterval(heartbeat); events.off("ai", send); });
  });
  app.post("/api/ai/connections", async (req, res) => res.json(await config.saveConnection(undefined, req.body)));
  app.put("/api/ai/connections/:id", async (req, res) => res.json(await config.saveConnection(String(req.params.id), req.body)));
  app.delete("/api/ai/connections/:id", (req, res) => { config.removeConnection(String(req.params.id)); res.json({ ok: true }); });
  app.post("/api/ai/connections/:id/check", async (req, res) => {
    const body = z.object({ model: z.string().max(200).optional() }).parse(req.body || {});
    res.json(await config.check(String(req.params.id), body.model));
  });
  app.post("/api/ai/assistants", (req, res) => res.json(config.saveAssistant(undefined, req.body)));
  app.put("/api/ai/assistants/:id", (req, res) => res.json(config.saveAssistant(String(req.params.id), req.body)));
  app.delete("/api/ai/assistants/:id", (req, res) => {
    const a = config.assistant(String(req.params.id)); if (a.builtin) throw Error("内置助手可以修改，不能删除");
    config.store.remove("aiAssistant", a.id); config.notify(); res.json({ ok: true });
  });
  app.put("/api/ai/preferences", (req, res) => res.json(config.savePreferences(req.body)));
  app.get("/api/ai/memories", (req, res) => res.json(config.memories(req.query.courseId ? String(req.query.courseId) : undefined)));
  app.post("/api/ai/memories", (req, res) => res.json(config.saveMemory(undefined, req.body)));
  app.put("/api/ai/memories/:id", (req, res) => { if (!config.store.get<AIMemory>("aiMemory", String(req.params.id))) throw Error("学习背景不存在"); res.json(config.saveMemory(String(req.params.id), req.body)); });
  app.delete("/api/ai/memories/:id", (req, res) => { config.store.remove("aiMemory", String(req.params.id)); config.notify(); res.json({ ok: true }); });
  app.get("/api/ai/usage", (req, res) => res.json(config.store.all<AIUsage>("aiUsage").filter(u => !req.query.connectionId || u.connectionId === String(req.query.connectionId)).reverse().slice(0, 1000)));
}
