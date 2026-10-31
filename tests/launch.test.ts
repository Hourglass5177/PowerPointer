import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFingerprint, dependencyFingerprint } from "../scripts/build-fingerprint.mjs";
import { buildEnvironment } from "../scripts/build.mjs";
import { defaultPort, listenFailure } from "../scripts/port.mjs";

test("默认端口避开 Windows 默认和本机常见的动态保留范围", () => {
  assert.equal(defaultPort, 17317);
  assert.ok(defaultPort > 15000 && defaultPort < 49152);
});

test("端口无法监听时说明原因和换端口方法，其他错误保留原文", () => {
  const denied = listenFailure({ code: "EACCES", message: "listen EACCES" }, 4317);
  assert.match(denied, /4317/);
  assert.match(denied, /Windows/);
  assert.match(denied, /\$env:PORT='17317'/);
  assert.match(listenFailure({ code: "EADDRINUSE", message: "listen EADDRINUSE" }, 17317), /已被其他程序占用.*\$env:PORT='17318'/s);
  assert.equal(listenFailure({ code: "EOTHER", message: "boom" }, 17317), "无法启动本地服务：boom");
});

test("启动指纹覆盖源码、配置和依赖，阅读数据变动不会触发构建", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lecture-launch-"));
  try {
    for (const folder of ["src", "data", "node_modules", "docs/manual", "public/manual"]) mkdirSync(path.join(root, folder), { recursive: true });
    const write = (name: string, content: string) => writeFileSync(path.join(root, name), content);
    write("package.json", "{}"); write("package-lock.json", "{}"); write("src/app.ts", "first");
    const first = buildFingerprint(root), dependency = dependencyFingerprint(root);
    assert.equal(buildFingerprint(root), first);
    write("data/notes.json", "new note"); assert.equal(buildFingerprint(root), first);
    write("src/app.ts", "changed"); assert.notEqual(buildFingerprint(root), first);
    assert.equal(dependencyFingerprint(root), dependency);
    const beforeManual = buildFingerprint(root);
    write("docs/manual/start.md", "manual text"); assert.notEqual(buildFingerprint(root), beforeManual);
    const beforeImage = buildFingerprint(root);
    write("public/manual/reading.png", "image contents"); assert.notEqual(buildFingerprint(root), beforeImage);
    const changed = buildFingerprint(root);
    write("node_modules/.package-lock.json", "resolved version"); assert.notEqual(buildFingerprint(root), changed);
    write("package-lock.json", "new lock"); assert.notEqual(dependencyFingerprint(root), dependency);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), "lecture-launch-")));
    rmSync(root, { recursive: true, force: true });
  }
});

test("构建改用项目内临时目录，不依赖系统临时目录的删除权限", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lecture-build-"));
  try {
    const env = buildEnvironment(root, {
      TEMP: "C:\\Windows\\Temp",
      TMP: "C:\\Windows\\Temp",
      PATH: "bin",
    });
    const local = path.join(root, "node_modules", ".cache", "tmp");
    assert.equal(env.TEMP, local);
    assert.equal(env.TMP, local);
    assert.equal(env.PATH, "bin");
    assert.ok(statSync(local).isDirectory());
  } finally {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), "lecture-build-")));
    rmSync(root, { recursive: true, force: true });
  }
});
