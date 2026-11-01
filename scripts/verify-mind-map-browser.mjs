import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = path.resolve(import.meta.dirname, ".."), assets = path.join(root, "dist", "assets");
mkdirSync(path.join(root, "output"), { recursive: true });
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(value => value && existsSync(value));
const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const docId = "a".repeat(64), courseId = "11111111-1111-4111-8111-111111111111", conversationId = "22222222-2222-4222-8222-222222222222";
const document = { id: docId, name: "微积分第一章.pdf", pages: 24, indexedPages: 24, indexStatus: "ready", page: 1, rotation: 0, zoom: 1, fitMode: "page", createdAt: "2026-10-28T00:00:00.000Z" };
const course = { id: courseId, name: "高等数学", files: [], documentIds: [docId], selectedDocumentIds: [docId], createdAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z", changes: [] };
const conversation = { id: conversationId, documentId: docId, documentName: document.name, courseId, title: "新会话", createdAt: "2026-10-28T00:00:00.000Z", connectionId: "codex" };
let maps = [];
const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
await page.route("https://powerpointer.test/**", async route => {
  const pathname = new URL(route.request().url()).pathname;
  const file = pathname === "/" ? path.join(root, "dist/index.html") : path.join(root, "dist", pathname);
  const type = /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
  try { await route.fulfill({ status: 200, contentType: type, body: readFileSync(file) }); }
  catch { await route.fulfill({ status: 404, body: "" }); }
});
await page.addInitScript(({ courseId, docId }) => {
  localStorage.setItem("pointer-course", courseId);
  localStorage.setItem("lecture-last-doc", docId);
  localStorage.setItem("pointer-guide-completed", "1");
  localStorage.setItem("pointer-workspace-view", "mindmap");
  const blobs = new Map(), create = URL.createObjectURL.bind(URL), click = HTMLAnchorElement.prototype.click;
  window.__exports = [];
  URL.createObjectURL = blob => { const url = create(blob); blobs.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function() {
    if (this.download && blobs.has(this.href)) { window.__exports.push({ filename: this.download, blob: blobs.get(this.href) }); return; }
    return click.call(this);
  };
}, { courseId, docId });
await page.route("**/api/**", async route => {
  const request = route.request(), url = new URL(request.url()), pathname = url.pathname, method = request.method();
  if (pathname === "/api/bootstrap") return json(route, { csrf: "test" });
  if (pathname === "/api/documents") return json(route, [document]);
  if (pathname === "/api/courses") return json(route, [course]);
  if (pathname === "/api/conversations") return json(route, [conversation]);
  if (pathname === "/api/auth") return json(route, { authenticated: true, plan: "test" });
  if (pathname === "/api/models") return json(route, [{ model: "test", displayName: "测试模型", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }], connectionId: "codex" }]);
  if (pathname === "/api/ai/config") return json(route, { connections: [], assistants: [], preferences: { id: "preferences", defaultConnectionId: "codex", favorites: [], recent: [], names: {}, profiles: { quick: {}, deep: {}, batch: {} } } });
  if (pathname === "/api/office") return json(route, { powerpoint: false, libreoffice: false });
  if (pathname === "/api/imports") return json(route, []);
  if (pathname === "/api/notes") return json(route, []);
  if (pathname === "/api/cleanup") return json(route, []);
  if (pathname === `/api/courses/${courseId}`) return json(route, course);
  if (pathname === `/api/courses/${courseId}/notes`) return json(route, []);
  if (pathname === `/api/courses/${courseId}/conversations`) return json(route, [conversation]);
  if (pathname === `/api/documents/${docId}/conversations`) return json(route, [conversation]);
  if (pathname === `/api/documents/${docId}/recent`) return json(route, { ...document, openedAt: new Date().toISOString() });
  if (pathname === `/api/documents/${docId}/pdf`) return route.fulfill({ status: 200, contentType: "application/pdf", body: readFileSync(path.join(root, "samples/微积分入门.pdf")) });
  if (pathname === "/api/reading/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify({ sessions: [], turns: [], courses: [course], knowledge: [], notesVersion: 0, cleanup: [] })}\n\n` });
  if (pathname === "/api/ai/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "data: {}\n\n" });
  if (pathname.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "data: []\n\n" });
  if (pathname === "/api/mind-maps" && method === "GET") return json(route, maps.filter(map => map.scope === url.searchParams.get("scope")));
  if (pathname === "/api/mind-maps" && method === "POST") {
    const body = request.postDataJSON(), rootId = crypto.randomUUID(), now = new Date().toISOString();
    const map = { id: crypto.randomUUID(), ...body, title: "高等数学 · 思维导图", rootId, nodes: [{ id: rootId, text: "高等数学", color: "#8b5543" }], layout: "tree", theme: "paper", version: 1, createdAt: now, updatedAt: now, ...body.imported };
    maps = [map, ...maps]; return json(route, map);
  }
  if (pathname === "/api/mind-maps/generate") {
    const input = request.postDataJSON(), current = maps.find(map => map.id === input.mapId);
    const rootId = crypto.randomUUID();
    const generated = { ...current, rootId, title: "AI 课程初稿", version: current.version + 1, nodes: [{ id: rootId, text: "AI 根主题" }, { id: crypto.randomUUID(), parentId: rootId, text: "AI 分支" }] };
    maps = maps.map(map => map.id === current.id ? generated : map);
    return json(route, generated);
  }
  if (pathname.startsWith("/api/mind-maps/") && method === "PUT") {
    const id = pathname.split("/").at(-1), body = request.postDataJSON(), current = maps.find(item => item.id === id);
    if (body.expectedVersion !== current.version) return json(route, { error: "版本冲突" }, 409);
    const saved = { ...current, ...body, version: current.version + 1, updatedAt: new Date().toISOString() };
    delete saved.expectedVersion; maps = maps.map(item => item.id === id ? saved : item); return json(route, saved);
  }
  if (pathname.startsWith("/api/mind-maps/") && method === "DELETE") { maps = maps.filter(item => !pathname.endsWith(item.id)); return json(route, { deleted: true }); }
  return json(route, {});
});
const errors = [];
page.on("dialog", dialog => dialog.accept());
page.on("pageerror", error => { errors.push(error.message); console.error("PAGE ERROR", error.message); });
await page.goto("https://powerpointer.test/", { waitUntil: "domcontentloaded" });
await page.locator(".workspace-tabs").waitFor();
await page.getByRole("button", { name: "导图", exact: true }).click();
await page.getByRole("button", { name: "新建空白导图", exact: true }).first().click();
await page.locator(".mind-map-node.root").waitFor();
await page.getByRole("button", { name: "子节点" }).click();
const inline = page.getByLabel("编辑节点标题");
await inline.fill("极限与连续");
await inline.press("Enter");
await page.getByLabel("节点属性").getByLabel("备注").fill("理解极限、连续与导数之间的关系");
await page.getByLabel("节点属性").getByLabel("备注").blur();
await page.getByRole("button", { name: "子节点" }).click();
await page.getByLabel("编辑节点标题").fill("极限定义");
await page.getByLabel("编辑节点标题").press("Enter");
await page.getByLabel("搜索导图节点").fill("极限");
await page.getByLabel("搜索导图节点").press("Enter");
await page.getByLabel("搜索导图节点").clear();
await page.getByTitle("适合画布", { exact: true }).click();
const branch = page.locator(".mind-map-node").filter({ hasText: "极限与连续" });
const box = await branch.boundingBox();
await page.mouse.move(box.x + 50, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + 80, box.y + 50, { steps: 5 });
await page.mouse.up();
assert.ok((await branch.boundingBox()).y > box.y + 10, "Branch drag moves the node");
await branch.getByRole("button", { name: "折叠分支" }).click();
assert.equal(await page.locator(".mind-map-node").count(), 2);
await branch.getByRole("button", { name: "展开分支" }).click();
assert.equal(await page.locator(".mind-map-node").count(), 3);
await page.screenshot({ path: path.join(root, "output", "mind-map-desktop.png"), fullPage: true });
await page.getByLabel("导入与导出").click();
await page.getByRole("button", { name: "导出 JSON" }).click();
const takeExport = async () => {
  await page.waitForFunction(() => window.__exports.length > 0);
  return page.evaluate(async () => { const item = window.__exports.shift(); return { filename: item.filename, bytes: [...new Uint8Array(await item.blob.arrayBuffer())] }; });
};
const download = await takeExport();
assert.ok(download.filename.endsWith(".json"));
assert.equal(JSON.parse(Buffer.from(download.bytes).toString()).nodes.length, 3);
for (const format of ["SVG", "PNG", "Markdown"]) {
  await page.getByLabel("导入与导出").click();
  await page.getByRole("button", { name: `导出 ${format}`, exact: true }).click();
  const exported = await takeExport();
  writeFileSync(path.join(root, "output", `mind-map-export.${format === "Markdown" ? "md" : format.toLowerCase()}`), Buffer.from(exported.bytes));
}
const png = await loadImage(path.join(root, "output/mind-map-export.png"));
const canvas = createCanvas(png.width, png.height), context = canvas.getContext("2d");
context.drawImage(png, 0, 0);
const pixels = context.getImageData(0, 0, png.width, png.height).data;
let colored = 0;
for (let i = 0; i < pixels.length; i += 4) if (Math.max(...pixels.slice(i, i + 3)) - Math.min(...pixels.slice(i, i + 3)) > 40) colored++;
assert.ok(colored > 100, "PNG should contain colored nodes");
await page.getByRole("button", { name: "阅读", exact: true }).first().click();
await page.getByRole("button", { name: "导图", exact: true }).click();
await page.locator(".mind-map-node").nth(2).waitFor();
assert.equal(await page.locator(".mind-map-node").count(), 3, "Workspace switch preserves latest edits");
await page.getByRole("button", { name: "AI 生成初稿", exact: true }).click();
await page.locator(".mind-map-node-title").filter({ hasText: "AI 根主题" }).waitFor();
assert.equal(await page.locator(".mind-map-node").count(), 2);
await page.getByRole("button", { name: "撤销 (Ctrl+Z)", exact: true }).click();
assert.equal(await page.locator(".mind-map-node").count(), 3, "AI replacement can be undone");
await page.getByRole("button", { name: "保存导图 (Ctrl+S)", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".mind-map-save-state")?.textContent === "已保存");
for (const width of [1024, 520, 390]) {
  await page.setViewportSize({ width, height: 820 });
  await page.getByTitle("适合画布", { exact: true }).click();
  await page.screenshot({ path: path.join(root, "output", `mind-map-${width}.png`), fullPage: true });
  const sizes = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(sizes.width <= sizes.viewport + 1, `No page overflow at ${width}`);
  const stage = await page.getByLabel("思维导图画布").boundingBox();
  const node = await page.locator(".mind-map-node.root").boundingBox();
  assert.ok(node.y >= stage.y && node.y + node.height <= stage.y + stage.height, `Root visible at ${width}`);
}
const nodeCount = await page.locator(".mind-map-node").count();
const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
console.log(JSON.stringify({ nodeCount, maps: maps.length, overflow, errors, exportFilename: download.filename, coloredPngPixels: colored }));
if (nodeCount !== 3 || errors.length || overflow.width > overflow.viewport + 1) process.exitCode = 1;
await browser.close();
