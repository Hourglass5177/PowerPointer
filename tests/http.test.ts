import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
test("本地接口：导入、去重、索引、页面图、跨站/越界/跨文档拒绝（无模型调用）", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "lecture-http-"));
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: path.resolve("."),
      env: { ...process.env, PORT: String(port), LECTURE_DATA_DIR: temporary },
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(origin + "/api/health")).ok;
        if (ready) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "server ready");
    const boot = await fetch(origin + "/api/bootstrap");
    const { csrf } = (await boot.json()) as any;
    const headers = {
      Cookie: `lecture_session=${csrf}`,
      "X-Lecture-Token": csrf,
    };
    const get = (url: string) => fetch(origin + url, { headers });
    const post = (url: string, body: any) =>
      fetch(origin + url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const upload = async (file: string) => {
      const f = new FormData();
      f.append(
        "file",
        new Blob([readFileSync(file)], { type: "application/pdf" }),
        path.basename(file),
      );
      const r = await fetch(origin + "/api/documents", {
        method: "POST",
        headers,
        body: f,
      });
      assert.equal(r.status, 200);
      return (await r.json()) as any;
    };
    const one = await upload("samples/微积分入门.pdf"),
      duplicate = await upload("samples/微积分入门.pdf"),
      scan = await upload("samples/纯扫描 图形.pdf");
    assert.equal(one.id, duplicate.id);
    assert.equal(
      ((await (await get("/api/documents")).json()) as any[]).length,
      2,
    );
    for (let i = 0; i < 100; i++) {
      const docs = (await (await get("/api/documents")).json()) as any[];
      if (docs.every((d) => d.indexStatus === "ready")) {
        assert.equal(docs.find((d) => d.id === scan.id).indexedPages, 0);
        break;
      }
      if (i === 99) assert.fail("index incomplete");
      await new Promise((r) => setTimeout(r, 100));
    }
    const found = (await (
      await get(
        `/api/documents/${one.id}/search?q=${encodeURIComponent("瞬时变化率")}`,
      )
    ).json()) as any[];
    assert.equal(found[0].page, 1);
    const image = await get(
      `/api/documents/${scan.id}/render?page=1&rotation=90&rect=${encodeURIComponent("[75,190,205,315]")}`,
    );
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.ok((await image.arrayBuffer()).byteLength > 1000);
    const conv = (await (
      await post(`/api/documents/${one.id}/conversations`, {})
    ).json()) as any;
    const mismatch = await post("/api/turns", {
      question: "must never invoke AI",
      snapshot: {
        documentId: scan.id,
        conversationId: conv.id,
        page: 1,
        rotation: 0,
        scope: "page",
      },
    });
    assert.equal(mismatch.status, 400);
    assert.match(((await mismatch.json()) as any).error, /不匹配/);
    assert.equal(
      (
        await fetch(origin + "/api/documents", {
          headers: { ...headers, Origin: "http://evil.invalid" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(origin + "/api/documents")).status, 403);
    assert.equal(
      (await get("/api/attachments/..%2F..%2Flocal-settings.json")).status,
      400,
    );
    assert.equal(
      (await get(`/api/documents/${one.id}/render?page=9999`)).status,
      400,
    );
    assert.equal(
      (await post("/api/command/exec", { command: "echo unsafe" })).status,
      404,
    );
    const exports = await get(`/api/conversations/${conv.id}/export`);
    assert.equal(exports.status, 200);
    assert.ok((await exports.text()).includes("微积分入门.pdf"));
    const createdNote = await post("/api/notes", { documentId: one.id, title: "手写笔记", text: "无需登录" });
    assert.equal(createdNote.status, 200);
    const note = await createdNote.json() as any;
    const edit = (version: number, text: string) => fetch(origin + "/api/notes/" + note.id, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ version, text }) });
    assert.equal((await edit(1, "已保存")).status, 200);
    assert.equal((await edit(1, "过期草稿")).status, 409);
    assert.equal((await fetch(origin + "/api/notes/" + note.id, { method: "DELETE", headers })).status, 200);
    assert.equal((await (await get("/api/notes?documentId=" + one.id)).json() as any[]).length, 0);
    assert.equal((await post("/api/notes/" + note.id + "/restore", {})).status, 200);
    assert.equal((await (await get("/api/notes?documentId=" + one.id)).json() as any[])[0].text, "已保存");
    const sample = await (await post("/api/sample", {})).json() as any;
    const again = await (await post("/api/sample", {})).json() as any;
    assert.equal(sample.course.id, again.course.id);
    assert.equal(again.course.documentIds.length, 1);
    assert.equal((await (await get("/api/documents")).json() as any[]).length, 2);
    const setup = await (await get("/api/setup")).json() as any;
    assert.equal(setup.node.ready, true);
    assert.equal(typeof setup.powerpoint, "boolean");
    const cropped = await (await post("/api/notes", { documentId: scan.id, title: "图表收藏", anchor: { id: randomUUID(), kind: "rectangle", documentId: scan.id, page: 1, rotation: 90, text: "", rect: [0, 0, 150, 150] } })).json() as any;
    assert.match(cropped.anchor.image, /^[a-f0-9-]+-0\.png$/);
    assert.equal((await fetch(origin + "/api/documents/" + scan.id, { method: "DELETE", headers })).status, 200);
    const kept = (await (await get("/api/notes?documentId=" + scan.id)).json() as any[])[0];
    assert.equal(kept.anchor.deleted, true);
    const frozen = await get("/api/attachments/" + kept.anchor.image);
    assert.equal(frozen.status, 200);
    assert.ok((await frozen.arrayBuffer()).byteLength > 100);
  } finally {
    child.kill();
    await new Promise<void>((r) => {
      if (child.exitCode !== null) r();
      else child.once("exit", () => r());
    });
    assert.ok(
      path
        .resolve(temporary)
        .startsWith(path.join(os.tmpdir(), "lecture-http-")),
    );
    rmSync(temporary, { recursive: true, force: true });
  }
});
