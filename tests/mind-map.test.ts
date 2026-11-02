import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import { CourseService } from "../server/courses.ts";
import { MindMapService } from "../server/mind-maps.ts";
import { powerRoutes } from "../server/power-routes.ts";
import express from "express";
import { EventEmitter } from "node:events";
import { layoutMindMap, mindMapNodeSummary, validateMindMapNodes, visibleMindMapNodes } from "../shared/mind-map.ts";
import type { ImportManager } from "../server/imports.ts";
import type { Document, MindMapNode } from "../shared/types.ts";

test("双向树布局区分左右分支，折叠后隐藏后代", () => {
  const root = randomUUID(), left = randomUUID(), right = randomUUID(), hidden = randomUUID();
  const nodes: MindMapNode[] = [
    { id: root, text: "课程" },
    { id: left, parentId: root, text: "左侧", side: "left" },
    { id: right, parentId: root, text: "右侧", side: "right", collapsed: true },
    { id: hidden, parentId: right, text: "隐藏内容" },
  ];
  validateMindMapNodes(nodes, root);
  const positions = layoutMindMap(nodes, root);
  assert.ok(positions.get(left)!.x < positions.get(root)!.x);
  assert.ok(positions.get(right)!.x > positions.get(root)!.x);
  assert.equal(positions.has(hidden), false);
  assert.deepEqual(visibleMindMapNodes(nodes, root).map(node => node.id), [root, left, right]);
});

test("导图持久化使用版本保护，AI 初稿保留有效来源", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mind-map-"));
  const store = new Store(dir);
  const document = {
    id: "a".repeat(64), name: "第一章.pdf", pages: 3, indexedPages: 3,
    indexStatus: "ready", page: 1, rotation: 0, zoom: 1, createdAt: "2026-10-28",
  } as Document;
  store.put("document", document);
  store.page(document.id, 1, "极限是微积分的基础概念");
  const courses = new CourseService(store, {} as ImportManager, () => {});
  const course = courses.create("高等数学", [document.id]);
  let prompt = "";
  const service = new MindMapService(store, courses, async input => {
    prompt = input.prompt;
    return {
      connectionId: "codex",
      model: "test-model",
      text: JSON.stringify({
        title: "高等数学导图",
        root: {
          text: "高等数学",
          children: [{
            text: "极限",
            summary: "当自变量趋近某点时，函数值趋近的确定值。",
            note: "函数变化趋势",
            source: { documentId: document.id, page: 1 },
            children: [{ text: "定义", children: [] }],
          }],
        },
      }),
    };
  });
  try {
    const created = service.create({ scope: "course", courseId: course.id });
    const child = randomUUID();
    const updated = service.update(created.id, created.version, {
      nodes: [...created.nodes, { id: child, parentId: created.rootId, text: "手工节点", summary: "  独立的知识简介  ", note: "自己的复习笔记" }],
    });
    assert.equal(updated.version, 2);
    assert.equal(service.get(created.id).nodes[1].summary, "独立的知识简介");
    assert.equal(service.get(created.id).nodes[1].note, "自己的复习笔记");
    assert.throws(() => service.update(created.id, 1, { title: "过期写入" }), /已在其他操作中更新/);
    const generated = await service.generate({
      mapId: updated.id,
      expectedVersion: updated.version,
      target: { scope: "course", courseId: course.id },
      settings: {},
    });
    assert.equal(generated.title, "高等数学导图");
    assert.equal(generated.nodes.length, 3);
    assert.equal(generated.nodes[1].source?.documentId, document.id);
    assert.equal(generated.nodes[1].summary, "当自变量趋近某点时，函数值趋近的确定值。");
    assert.equal(generated.nodes[1].note, "函数变化趋势");
    assert.equal(generated.generatedWith?.model, "test-model");
    assert.match(prompt, /极限是微积分的基础概念/);
    assert.match(prompt, /每个节点都在 summary/);
    assert.match(prompt, /禁止猜测页码/);
    assert.equal(service.list({ scope: "course", courseId: course.id })[0].id, generated.id);
  } finally {
    courses.close();
    store.close();
    assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "mind-map-")));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("导图拒绝循环或断开的节点树", () => {
  const root = randomUUID(), child = randomUUID();
  assert.throws(() => validateMindMapNodes([
    { id: root, text: "根", parentId: child },
    { id: child, text: "子", parentId: root },
  ], root), /根节点|循环/);
});

test("知识简介优先独立内容，兼容旧导图备注和空白知识点", () => {
  const node = { id: randomUUID(), text: "知识点", note: "旧版知识说明" };
  assert.equal(mindMapNodeSummary(node), "旧版知识说明");
  assert.equal(mindMapNodeSummary({ ...node, summary: "新的知识简介" }), "新的知识简介");
  assert.equal(mindMapNodeSummary({ id: node.id, text: node.text }), "");
});

test("AI 生成时的并发修改、删除、无效结果不会覆盖原导图", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mind-map-race-"));
  const store = new Store(dir);
  const doc = { id: "b".repeat(64), name: "课程.pdf", pages: 1 } as Document;
  store.put("document", doc); store.page(doc.id, 1, "并发测试正文");
  const courses = new CourseService(store, {} as ImportManager, () => {});
  let release: (text: string) => void = () => {};
  const service = new MindMapService(store, courses, async () => ({ text: await new Promise<string>(resolve => { release = resolve; }) }));
  try {
    const map = service.create({ scope: "document", documentId: doc.id });
    const pending = service.generate({ mapId: map.id, expectedVersion: map.version, target: map, settings: {} });
    await new Promise(resolve => setImmediate(resolve));
    service.update(map.id, map.version, { title: "用户最新编辑" });
    release(JSON.stringify({ title: "AI 旧结果", root: { text: "旧内容", children: [] } }));
    await assert.rejects(pending, /生成期间导图已更新/);
    assert.equal(service.get(map.id).title, "用户最新编辑");
    const invalid = service.generate({ mapId: map.id, expectedVersion: 2, target: map, settings: {} });
    await new Promise(resolve => setImmediate(resolve)); release("不是 JSON");
    await assert.rejects(invalid, /没有返回|格式/);
    assert.equal(service.get(map.id).title, "用户最新编辑");
    const deleting = service.generate({ mapId: map.id, expectedVersion: 2, target: map, settings: {} });
    await new Promise(resolve => setImmediate(resolve)); service.remove(map.id);
    release(JSON.stringify({ title: "AI 旧结果", root: { text: "旧内容", children: [] } }));
    await assert.rejects(deleting, /不存在/);
    assert.equal(store.all("mindMap").length, 0);
  } finally {
    courses.close(); store.close();
    assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "mind-map-race-")));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("长文档末尾参与生成，独立课件不会读入其他课程笔记", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mind-map-context-"));
  const store = new Store(dir);
  const doc = { id: "c".repeat(64), name: "长课件.pdf", pages: 2 } as Document;
  store.put("document", doc);
  store.page(doc.id, 1, "前段材料".repeat(5000));
  store.page(doc.id, 2, "末尾独特知识点");
  store.put("note", { id: randomUUID(), courseId: randomUUID(), title: "隔离笔记", text: "不能泄露的其他课程", sources: [] });
  const courses = new CourseService(store, {} as ImportManager, () => {});
  const prompts: string[] = [];
  const service = new MindMapService(store, courses, async input => {
    prompts.push(input.prompt);
    return { text: input.prompt.startsWith("你要") ? JSON.stringify({ title: "长课件", root: { text: "知识", children: [] } }) : "压缩后概念与页码" };
  });
  try {
    await service.generate({ target: { scope: "document", documentId: doc.id }, settings: {} });
    assert.ok(prompts.length >= 3);
    assert.ok(prompts.some(prompt => prompt.includes("末尾独特知识点")));
    assert.ok(prompts.every(prompt => !prompt.includes("不能泄露的其他课程")));
  } finally {
    courses.close(); store.close();
    assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "mind-map-context-")));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("实际路由校验、导入事务和 AI 撤销后根节点保存", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mind-map-routes-"));
  const store = new Store(dir);
  const doc = { id: "d".repeat(64), name: "路由课件.pdf", pages: 1 } as Document;
  store.put("document", doc); store.page(doc.id, 1, "节点正文");
  const courses = new CourseService(store, {} as ImportManager, () => {});
  const mindMaps = new MindMapService(store, courses, async () => ({ text: JSON.stringify({ title: "AI 初稿", root: { text: "AI 根", children: [] } }) }));
  const app = express();
  powerRoutes(app, { store, courses, mindMaps } as Parameters<typeof powerRoutes>[1]);
  const invoke = async (method: string, routePath: string, body: object, params: object = {}) => {
    const layer: any = app.router.stack.find((item: any) => item.route?.path === routePath && item.route.methods[method]);
    assert.ok(layer, `Missing route: ${method} ${routePath}`);
    let value: any;
    const response = new EventEmitter() as any;
    response.json = (result: unknown) => { value = result; };
    response.writableEnded = false;
    await layer.route.stack[0].handle({ body, params, query: {} }, response, () => {});
    return value;
  };
  try {
    const created = await invoke("post", "/api/mind-maps", { scope: "document", documentId: doc.id });
    assert.equal(created.version, 1);
    assert.equal(created.imported, undefined);
    const generated = await invoke("post", "/api/mind-maps/generate", { scope: "document", documentId: doc.id, mapId: created.id, expectedVersion: 1 });
    assert.equal(generated.title, "AI 初稿");
    const restored = await invoke("put", "/api/mind-maps/:id", { expectedVersion: generated.version, rootId: created.rootId, nodes: created.nodes }, { id: created.id });
    assert.equal(restored.rootId, created.rootId);
    const imported = await invoke("post", "/api/mind-maps", { scope: "document", documentId: doc.id,
      imported: { rootId: created.rootId, nodes: [{ ...created.nodes[0], summary: "导入的简介", note: "独立备注", source: { documentId: doc.id, page: 1 } }], theme: "paper", layout: "tree" },
    });
    assert.equal(imported.nodes[0].summary, "导入的简介");
    assert.equal(imported.nodes[0].source.documentName, doc.name);
    assert.equal(mindMaps.get(imported.id).nodes[0].note, "独立备注");
    await assert.rejects(invoke("put", "/api/mind-maps/:id", { expectedVersion: imported.version,
      nodes: [{ ...imported.nodes[0], summary: "长".repeat(1201) }] }, { id: imported.id }));
    await assert.rejects(invoke("put", "/api/mind-maps/:id", { expectedVersion: imported.version,
      nodes: [{ ...imported.nodes[0], source: { documentId: doc.id, page: 2 } }] }, { id: imported.id }), /无效的课件页码/);
    await assert.rejects(invoke("put", "/api/mind-maps/:id", { expectedVersion: imported.version,
      nodes: [{ ...imported.nodes[0], source: { documentId: "e".repeat(64), page: 1 } }] }, { id: imported.id }), /无效的课件页码/);
    assert.equal(mindMaps.get(imported.id).version, imported.version, "Invalid changes leave the stored version untouched");
    const before = store.all("mindMap").length;
    await assert.rejects(invoke("post", "/api/mind-maps", { scope: "document", documentId: doc.id, imported: { rootId: randomUUID(), nodes: created.nodes, theme: "paper", layout: "tree" } }), /根节点/);
    assert.equal(store.all("mindMap").length, before);
  } finally {
    courses.close(); store.close();
    assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), "mind-map-routes-")));
    rmSync(dir, { recursive: true, force: true });
  }
});
