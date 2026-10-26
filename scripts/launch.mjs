import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFingerprint, dependencyFingerprint } from "./build-fingerprint.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("需要 Node.js 24 或更新版本。");
  process.exit(1);
}
const npm = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [npm, ...args], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`npm ${args.join(" ")} 失败 (${code})`)),
    );
  });
}
const port = process.env.PORT || "4317",
  url = `http://127.0.0.1:${port}`;
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error("PORT 必须是 1 到 65535 的整数。");
  process.exit(1);
}
function open() {
  if (process.env.LECTURE_NO_BROWSER) return;
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Start-Process '${url}'`],
    { windowsHide: true },
  );
}
try {
  console.log("[检查] Node.js " + process.versions.node);
  const cachePath = path.join(root, "node_modules", ".cache", "power-pointer-launch.json");
  let cached = {};
  try { cached = JSON.parse(readFileSync(cachePath, "utf8")); } catch {}
  const before = buildFingerprint(root);
  try {
    const r = await fetch(url + "/api/health", {
      signal: AbortSignal.timeout(1200),
    });
    const running = await r.json().catch(() => null);
    if (running?.app === "lecture-copilot") {
      if (running.build !== before) throw Error("应用正在运行其他版本。请关闭原启动窗口，再运行启动.cmd。");
      console.log("[就绪] 已打开正在运行的 Power Pointer。");
      open();
      process.exit(0);
    }
    throw Error("端口被其他服务占用");
  } catch (e) {
    if (e.message === "端口被其他服务占用" || e.message.includes("正在运行其他版本")) throw e;
  }
  const dependency = dependencyFingerprint(root);
  if (!existsSync("node_modules/tsx") || cached.dependency !== dependency) {
    console.log("[准备] 安装或更新项目依赖…");
    await run(["ci"]);
    cached = { dependency };
  }
  mkdirSync(path.dirname(cachePath), { recursive: true });
  const fingerprint = buildFingerprint(root);
  if (cached.build !== fingerprint || !existsSync(path.join(root, "dist", "index.html"))) {
    writeFileSync(cachePath, JSON.stringify({ dependency }));
    console.log("[准备] 源码或依赖有变化，正在构建…");
    await run(["run", "build"]);
    writeFileSync(cachePath, JSON.stringify({ dependency, build: fingerprint }));
  } else console.log("[准备] 源码和依赖未变化，使用已有构建。");
  console.log("[启动] 正在启动本地阅读器…");
  const server = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, LECTURE_BUILD_FINGERPRINT: fingerprint } },
  );
  server.on("error", (e) => {
    console.error(e);
    process.exit(1);
  });
  server.on("exit", (code) => process.exit(code || 0));
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(url + "/api/health", {
        signal: AbortSignal.timeout(500),
      });
      if (r.ok) {
        console.log(`[就绪] ${url}\n关闭此窗口可结束本应用。`);
        open();
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
    if (i === 79) {
      server.kill();
      throw Error("服务启动超时");
    }
  }
  process.on("SIGINT", () => server.kill());
  process.on("SIGTERM", () => server.kill());
} catch (e) {
  console.error("[启动失败] " + e.message + "\n请处理上述问题后重新启动。");
  process.exit(1);
}
