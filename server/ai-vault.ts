import { spawn } from "node:child_process";
import { Store } from "./store.ts";

// Secrets cross the child-process boundary through stdin, never command arguments.
export class SecretVault {
  constructor(private store: Store) {}
  private transform(value: string, decrypt: boolean): Promise<string> {
    if (process.platform !== "win32") throw Error("凭据存储需要 Windows 当前用户 DPAPI；本机未启用其他明文存储方式。");
    const script = `Add-Type -AssemblyName System.Security; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $v=[Console]::In.ReadToEnd(); $b=${decrypt ? "[Convert]::FromBase64String($v)" : "[Text.Encoding]::UTF8.GetBytes($v)"}; $r=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt ? "[Text.Encoding]::UTF8.GetString($r)" : "[Convert]::ToBase64String($r)"})`;
    return new Promise((resolve, reject) => {
      const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      const timer = setTimeout(() => { p.kill(); reject(Error("凭据保险库响应超时")); }, 15000);
      p.stdout.on("data", b => { output += b.toString(); });
      p.stderr.resume();
      p.once("error", () => { clearTimeout(timer); reject(Error("无法启动 Windows 凭据保险库")); });
      p.once("close", code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(Error("无法读取当前 Windows 用户的加密凭据")); });
      p.stdin.end(value);
    });
  }
  has(id: string) { return !!this.store.get("aiSecret", id); }
  async set(id: string, value: string) {
    if (!value) { this.store.remove("aiSecret", id); return; }
    this.store.put("aiSecret", { id, encrypted: await this.transform(value, false) });
  }
  async get(id: string) {
    const record = this.store.get<{ encrypted: string }>("aiSecret", id);
    return record ? this.transform(record.encrypted, true) : "";
  }
  remove(id: string) { this.store.remove("aiSecret", id); }
}
