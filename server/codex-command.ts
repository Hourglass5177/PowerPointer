import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type CodexCommand = { command: string; args: string[] };

export function discoverCodexCommand(options: {
  executable?: string;
  fallback?: string;
  env?: NodeJS.ProcessEnv;
} = {}): CodexCommand {
  const env = options.env || process.env;
  const configured = options.executable?.trim() || env.LECTURE_CODEX_PATH?.trim();
  if (configured) return resolveCodexCommand(configured);

  const names = process.platform === "win32"
    ? ["codex.exe", "codex.com", "codex.cmd", "codex.ps1", "codex"]
    : ["codex"];
  const candidates: string[] = [];
  const addDirectory = (directory?: string) => {
    const folder = directory?.trim().replace(/^"(.*)"$/, "$1");
    if (folder) candidates.push(...names.map(name => path.join(folder, name)));
  };
  // Try every PATH entry: an obsolete wrapper must not hide a working install.
  const searchPath = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1];
  for (const folder of (searchPath || "").split(path.delimiter)) addDirectory(folder);
  if (process.platform === "win32") {
    if (env.APPDATA) addDirectory(path.join(env.APPDATA, "npm"));
    if (env.LOCALAPPDATA) {
      const bin = path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
      addDirectory(bin);
      // Desktop updates replace versioned directories while already-running apps
      // retain their old PATH. Discover the current install again on reconnect.
      try {
        const versions = readdirSync(bin, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .flatMap(entry => {
            const folder = path.join(bin, entry.name);
            try { return [{ folder, modified: statSync(path.join(folder, "codex.exe")).mtimeMs }]; }
            catch { return []; }
          })
          .sort((a, b) => b.modified - a.modified || a.folder.localeCompare(b.folder));
        for (const { folder } of versions) addDirectory(folder);
      } catch { /* Desktop CLI is not installed for this user. */ }
    }
  }
  if (options.fallback) candidates.push(options.fallback);
  for (const candidate of new Set(candidates)) {
    try { return resolveCodexCommand(candidate); }
    catch { /* Continue past missing executables and stale npm wrappers. */ }
  }
  throw Error("找不到 Codex CLI。请安装官方 CLI 后重试；已安装时请检查安装是否完整。");
}

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
