import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AIConfig } from "../server/ai-config.ts";
import { Codex } from "../server/codex.ts";
import { resolveCodexCommand } from "../server/codex-command.ts";
import { Store } from "../server/store.ts";
import type { AIConnection } from "../shared/ai.ts";

const entry = "node_modules/@openai/codex/bin/codex.js";
const shims: Record<string, string> = {
  // Shim bodies follow the files npm writes for a global install.
  "codex.cmd": `@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`,
  "codex.ps1": `#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& "node$exe"  "$basedir/${entry}" $args\n`,
  codex: `#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\nexec node  "$basedir/${entry}" "$@"\n`,
};

function install() {
  const dir = mkdtempSync(path.join(tmpdir(), "codex 路径-"));
  for (const [name, body] of Object.entries(shims)) writeFileSync(path.join(dir, name), body);
  const script = path.join(dir, entry);
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, `console.log(JSON.stringify(process.argv.slice(2)));\n`);
  return { dir, script };
}

for (const name of Object.keys(shims)) test(`npm 包装脚本 ${name} 解析为由当前 Node 启动的真实入口`, () => {
  const { dir, script } = install();
  try {
    assert.deepEqual(resolveCodexCommand(path.join(dir, name)), { command: process.execPath, args: [script] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("解析结果可直接启动，含引号和命令元字符的参数原样到达", () => {
  const { dir } = install();
  try {
    const { command, args } = resolveCodexCommand(path.join(dir, "codex.cmd"));
    const input = ['key={ "a" = "b c" }', "x&calc.exe", "%PATH%"];
    assert.deepEqual(JSON.parse(execFileSync(command, [...args, ...input], { encoding: "utf8", windowsHide: true })), input);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("手动路径可以带复制时的引号和空白", () => {
  const { dir, script } = install();
  try {
    assert.deepEqual(resolveCodexCommand(`  "${path.join(dir, "codex.ps1")}" `), { command: process.execPath, args: [script] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("原生程序直接启动，JS 入口交给 Node", () => {
  const { dir, script } = install();
  try {
    const exe = path.join(dir, "codex.exe");
    writeFileSync(exe, "");
    assert.deepEqual(resolveCodexCommand(exe), { command: exe, args: [] });
    assert.deepEqual(resolveCodexCommand(script), { command: process.execPath, args: [script] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("无法安全解析的路径明确报错，不交给命令行执行", () => {
  const { dir } = install();
  try {
    const custom = path.join(dir, "my-codex.cmd"), missingEntry = path.join(dir, "stale.cmd"), other = path.join(dir, "codex.txt");
    writeFileSync(custom, "@echo off\r\ncodex %*\r\n");
    writeFileSync(missingEntry, `"%dp0%\\node_modules\\gone\\codex.js" %*\r\n`);
    writeFileSync(other, "");
    assert.throws(() => resolveCodexCommand(custom), /codex\.exe/);
    assert.throws(() => resolveCodexCommand(missingEntry), /codex\.exe/);
    assert.throws(() => resolveCodexCommand(other), /codex\.exe/);
    assert.throws(() => resolveCodexCommand(dir), /codex\.exe/);
    assert.throws(() => resolveCodexCommand(path.join(dir, "missing.exe")), /找不到 Codex CLI/);
    assert.throws(() => resolveCodexCommand(""), /找不到 Codex CLI/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Speaks just enough app-server JSON-RPC for a connection check and records every method it sees.
const fakeAppServer = `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("codex-cli fake"); process.exit(0); }
const features = Object.fromEntries(argv.flatMap(a => /^features\\.(\\w+)=false$/.exec(a)?.slice(1) ?? []).map(k => [k, false]));
const results = {
  "config/read": { config: { features } },
  "account/read": { account: { type: "chatgpt", planType: "plus" } },
  "account/rateLimits/read": { rateLimits: { limitId: "codex", primary: { usedPercent: 10 } } },
};
createInterface({ input: process.stdin }).on("line", line => {
  const m = JSON.parse(line);
  appendFileSync(process.env.FAKE_CODEX_LOG, m.method + "\\n");
  if (m.id !== undefined) console.log(JSON.stringify({ id: m.id, result: results[m.method] ?? {} }));
});
`;

test("从 npm 包装脚本启动 app-server 完成连接检查，且清除旧错误、不发起推理", async () => {
  const { dir, script } = install();
  const log = path.join(dir, "methods.log"), previous = process.env.FAKE_CODEX_LOG;
  writeFileSync(script.replace(/codex\.js$/, "codex.mjs"), fakeAppServer);
  const shim = path.join(dir, "codex.ps1");
  writeFileSync(shim, shims["codex.ps1"].replace("codex.js", "codex.mjs"));
  process.env.FAKE_CODEX_LOG = log;
  const data = path.join(dir, "data"), store = new Store(data), codex = new Codex(data);
  try {
    const config = new AIConfig(store, codex, () => {});
    const saved = store.get<AIConnection>("aiConnection", "codex")!;
    await config.saveConnection("codex", { ...saved, codexPath: shim });
    store.put("aiConnection", { ...config.connection("codex"), status: "error", error: "spawnSync codex.ps1 EFTYPE" });
    const result = await config.check("codex");
    assert.equal(result.authenticated, true);
    assert.equal("version" in result && result.version, "codex-cli fake");
    const stored = config.connection("codex");
    assert.equal(stored.status, "ready");
    assert.equal(stored.error, undefined);
    const methods = readFileSync(log, "utf8").trim().split("\n");
    assert.deepEqual(methods.filter(m => /^(thread|turn)\//.test(m)), []);
    assert.ok(methods.includes("account/read"));
  } finally {
    await codex.shutdown(); store.close();
    if (previous === undefined) delete process.env.FAKE_CODEX_LOG; else process.env.FAKE_CODEX_LOG = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
