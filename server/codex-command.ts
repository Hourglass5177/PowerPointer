import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type CodexCommand = { command: string; args: string[] };

// Written by npm/pnpm into codex.cmd, codex.ps1 and the extensionless sh shim.
const shimEntry = /(?:%~?dp0%?|\$basedir)[\\/]+([^"'\r\n;%$]+?\.[cm]?js)(?=["'])/i;

// Node refuses .cmd/.bat without a shell (EINVAL) and cannot execute .ps1 or sh shims at all
// (EFTYPE/ENOENT). A shell would re-parse model and config arguments, so npm shims are unwrapped
// to their JS entry and run with the current Node; anything else must be a native program.
export function resolveCodexCommand(input: string): CodexCommand {
  const file = input.trim().replace(/^"(.*)"$/, "$1");
  if (!file || !existsSync(file))
    throw Error("找不到 Codex CLI。请通过官方方式安装，或在连接设置、local-settings.json 中填写 codex.exe 或 npm 生成的 codex.cmd 路径。");
  const unsupported = Error(`无法启动 ${file}。请填写 codex.exe，或 npm 全局安装生成的 codex.cmd、codex.ps1。`);
  if (!statSync(file).isFile()) throw unsupported;
  const ext = path.extname(file).toLowerCase();
  if (ext === ".exe" || ext === ".com" || (!ext && process.platform !== "win32")) return { command: file, args: [] };
  if (/^\.[cm]?js$/.test(ext)) return { command: process.execPath, args: [file] };
  if (ext && ![".cmd", ".bat", ".ps1"].includes(ext)) throw unsupported;
  const relative = shimEntry.exec(readFileSync(file, "utf8"))?.[1];
  const entry = relative && path.resolve(path.dirname(file), relative);
  if (!entry || !existsSync(entry)) throw unsupported;
  return { command: process.execPath, args: [entry] };
}
