import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * esbuild 会把较大的转换输入写到系统临时目录，再在同一个进程里删除。
 * 部分 Windows 安全软件/策略会在此刻短暂占用文件，导致构建报
 * `remove ...: Access is denied`。构建统一改用项目内临时目录，避免依赖
 * 系统临时目录的删除权限；目录本身位于 node_modules 下，不进入版本库。
 */
export function buildEnvironment(root, base = process.env) {
  const temp = path.join(root, "node_modules", ".cache", "tmp");
  mkdirSync(temp, { recursive: true });
  return { ...base, TEMP: temp, TMP: temp };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const npm = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const child = spawn(process.execPath, [npm, "run", "build:core"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: buildEnvironment(root),
  });
  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}
