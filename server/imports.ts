import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile, copyFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import * as CFB from "cfb";
import { Store } from "./store.ts";
import { openPdf } from "./pdf.ts";
import type { Document, ImportJob, ImportEngine } from "../shared/types.ts";

export function fileFormat(bytes: Buffer, name: string): ImportJob["format"] {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf" && bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    return "pdf";
  if (![".ppt", ".pptx"].includes(ext))
    throw Error("请选择 PDF、PPT 或 PPTX 文件");
  if (bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) {
    let cfb;
    try {
      cfb = CFB.read(bytes, { type: "buffer" });
    } catch {
      throw Error("演示文稿已损坏");
    }
    // MS-PPT 2.3.2: CurrentUserAtom.headerToken is a little-endian uint32
    // at offset 12. Password-protected binary .ppt uses 0xF3D1C4DF.
    const currentUser = cfb.FileIndex.find(
      (x) => x.name === "Current User",
    )?.content;
    const binaryEncrypted =
      currentUser &&
      currentUser.length >= 16 &&
      Buffer.from(currentUser as Uint8Array).readUInt32LE(12) === 0xf3d1c4df;
    if (
      binaryEncrypted ||
      cfb.FileIndex.some((x) =>
        ["EncryptedPackage", "EncryptionInfo"].includes(x.name),
      )
    )
      throw Error("文件已加密，请先在 PowerPoint 中另存为无密码副本");
    if (
      ext === ".ppt" &&
      cfb.FileIndex.some((x) => x.name === "PowerPoint Document")
    )
      return "ppt";
  }
  if (
    ext === ".pptx" &&
    bytes.subarray(0, 4).equals(Buffer.from("504b0304", "hex"))
  ) {
    try {
      let total = 0;
      const entries = unzipSync(bytes, {
        filter: (e) => {
          total += e.originalSize;
          if (total > 512 * 1024 * 1024 || e.originalSize > 100 * 1024 * 1024)
            throw Error("文件解压体积过大");
          return ["[Content_Types].xml", "ppt/presentation.xml"].includes(
            e.name,
          );
        },
      });
      if (
        entries["ppt/presentation.xml"] &&
        strFromU8(entries["[Content_Types].xml"] || new Uint8Array()).includes(
          "presentationml.presentation.main+xml",
        )
      )
        return "pptx";
    } catch (e) {
      throw Error(`演示文稿已损坏或无法读取：${(e as Error).message}`);
    }
  }
  throw Error("文件内容与扩展名不符，或演示文稿已损坏");
}

const script = fileURLToPath(new URL("./office.ps1", import.meta.url));
function processRun(
  exe: string,
  args: string[],
  signal?: AbortSignal,
  cancellationFile?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (cancellationFile) {
        // Let the current COM call return, then the helper's finally block closes
        // only our document. Do not terminate a shared PowerPoint process.
        try {
          writeFileSync(cancellationFile, "cancel");
        } catch {}
        abortTimer = setTimeout(() => child.kill(), 15000);
      } else if (process.platform === "win32" && signal && child.pid) {
        // LibreOffice owns an isolated profile and its entire child process tree.
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (b) => {
      out = (out + b).slice(-12000);
    });
    child.stderr.on("data", (b) => {
      err = (err + b).slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(abortTimer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(signal.reason || Error("已取消"));
      else if (code !== 0)
        reject(Error(err.trim() || out.trim() || "转换程序执行失败"));
      else resolve(out);
    });
    if (signal?.aborted) abort();
  });
}

export async function officeCapabilities() {
  let powerpoint = "",
    libreoffice = "";
  if (process.platform === "win32") {
    try {
      const r = await processRun("reg.exe", [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE",
        "/ve",
      ]);
      powerpoint = r.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "";
    } catch {}
  }
  for (const p of [
    process.env.LECTURE_POWERPOINT_PATH,
    powerpoint,
    "C:/Program Files/Microsoft Office/Root/Office16/POWERPNT.EXE",
  ])
    if (p && existsSync(p)) {
      powerpoint = p;
      break;
    }
  for (const p of [
    process.env.LECTURE_LIBREOFFICE_PATH,
    "C:/Program Files/LibreOffice/program/soffice.com",
    "C:/Program Files (x86)/LibreOffice/program/soffice.com",
  ])
    if (p && existsSync(p)) {
      libreoffice = p;
      break;
    }
  return {
    powerpoint: !!powerpoint && existsSync(powerpoint),
    libreoffice: !!libreoffice,
    libreofficePath: libreoffice,
  };
}

export async function convertOffice(
  input: string,
  output: string,
  engine: ImportEngine,
  signal: AbortSignal,
): Promise<number | undefined> {
  if (engine === "powerpoint") {
    const cancellationFile = path.join(
      path.dirname(output),
      "powerpoint.cancel",
    );
    await rm(cancellationFile, { force: true });
    const raw = await processRun(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-InputFile",
        input,
        "-OutputFile",
        output,
        "-CancelFile",
        cancellationFile,
      ],
      signal,
      cancellationFile,
    );
    const result = raw
      .trim()
      .split(/\r?\n/)
      .findLast((x) => x.startsWith("{"));
    return result ? JSON.parse(result).pages : undefined;
  }
  const capabilities = await officeCapabilities();
  if (!capabilities.libreofficePath) throw Error("未找到 LibreOffice");
  const profile = path.join(path.dirname(output), "lo-profile");
  mkdirSync(path.join(profile, "user"), { recursive: true });
  await writeFile(
    path.join(profile, "user", "registrymodifications.xcu"),
    `<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateLinks" oor:op="fuse"><value>false</value></prop></item></oor:items>`,
  );
  await processRun(
    capabilities.libreofficePath,
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--norestore",
      "--convert-to",
      'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}',
      "--outdir",
      path.dirname(output),
      input,
    ],
    signal,
  );
  const produced = path.join(
    path.dirname(output),
    path.parse(input).name + ".pdf",
  );
  if (produced !== output) await rename(produced, output);
  return undefined;
}

type Converter = typeof convertOffice;
export class ImportManager {
  private queue = Promise.resolve();
  private running = new Map<string, AbortController>();
  private closed = false;
  constructor(
    private store: Store,
    private onDocument: (doc: Document) => void,
    private convert: Converter = convertOffice,
    private capabilities = officeCapabilities,
    private timeout = 180000,
  ) {
    for (const folder of ["originals", "imports", "pdfs"])
      mkdirSync(path.join(store.dir, folder), { recursive: true });
    for (const job of this.list())
      if (["queued", "processing"].includes(job.state))
        this.save({ ...job, state: "failed", error: "上次导入已中断，请重试" });
  }
  list() {
    return this.store.all<ImportJob>("import");
  }
  get(id: string) {
    const job = this.store.get<ImportJob>("import", id);
    if (!job) throw Error("导入任务不存在");
    return job;
  }
  private save(job: ImportJob) {
    return this.store.put("import", job);
  }
  async create(bytes: Buffer, name: string) {
    const format = fileFormat(bytes, name),
      hash = createHash("sha256").update(bytes).digest("hex");
    let existing = this.store.document(hash);
    const pending = this.list().find(
      (j) => j.hash === hash && ["queued", "processing"].includes(j.state),
    );
    if (pending) return pending;
    await writeFile(
      path.join(this.store.dir, "originals", `${hash}.${format}`),
      bytes,
    );
    // A second upload can finish hashing while the first is writing its copy.
    const concurrent = this.list().find(
      (j) => j.hash === hash && ["queued", "processing"].includes(j.state),
    );
    if (concurrent) return concurrent;
    existing = this.store.document(hash);
    const job: ImportJob = {
      id: randomUUID(),
      name: path.basename(name),
      hash,
      format,
      state: existing ? "completed" : "queued",
      documentId: existing?.id,
      createdAt: new Date().toISOString(),
    };
    this.save(job);
    if (!existing) this.enqueue(job.id);
    return job;
  }
  cancel(id: string) {
    const job = this.get(id);
    if (["queued", "processing"].includes(job.state)) {
      this.save({ ...job, state: "cancelled", error: undefined });
      this.running.get(id)?.abort(Error("已取消"));
    }
    return this.get(id);
  }
  retry(id: string, engine?: ImportEngine) {
    const job = this.get(id);
    if (!["failed", "cancelled"].includes(job.state))
      throw Error("任务当前不可重试");
    this.save({
      ...job,
      state: "queued",
      engine: job.format === "pdf" ? "pdf" : engine,
      error: undefined,
    });
    this.enqueue(id);
    return this.get(id);
  }
  close() {
    this.closed = true;
    for (const controller of this.running.values())
      controller.abort(Error("导入已中断"));
  }
  private enqueue(id: string) {
    this.queue = this.queue.then(() => this.run(id)).catch(() => {});
  }
  private async run(id: string) {
    let job = this.get(id);
    if (this.closed || job.state !== "queued") return;
    const controller = new AbortController();
    this.running.set(id, controller);
    const timer = setTimeout(
      () => controller.abort(Error("转换超时（180 秒），请重试或使用兼容引擎")),
      this.timeout,
    );
    const temporary = path.join(this.store.dir, "imports", id);
    if (
      !path
        .resolve(temporary)
        .startsWith(path.resolve(this.store.dir, "imports") + path.sep)
    )
      throw Error("无效的导入任务路径");
    mkdirSync(temporary, { recursive: true });
    const output = path.join(temporary, "render.pdf");
    try {
      job = this.save({ ...job, state: "processing" });
      const engines = await this.capabilities();
      controller.signal.throwIfAborted();
      const engine =
        job.format === "pdf"
          ? "pdf"
          : job.engine ||
            (engines.powerpoint
              ? "powerpoint"
              : engines.libreoffice
                ? "libreoffice"
                : undefined);
      if (!engine || (engine !== "pdf" && !engines[engine]))
        throw Error(
          "未找到可用的本地转换程序，请安装 PowerPoint 或 LibreOffice 后重试",
        );
      job = this.save({ ...job, engine, state: "processing" });
      const input = path.join(
        this.store.dir,
        "originals",
        `${job.hash}.${job.format}`,
      );
      const count =
        engine === "pdf"
          ? (await copyFile(input, output), undefined)
          : await this.convert(input, output, engine, controller.signal);
      controller.signal.throwIfAborted();
      const pdf = await openPdf(output);
      let pages: number;
      try {
        pages = pdf.numPages;
        if (pages < 1 || (count !== undefined && pages !== count))
          throw Error("转换后的页数与幻灯片数量不符");
        await pdf.getPage(1);
      } finally {
        await pdf.destroy();
      }
      controller.signal.throwIfAborted();
      if (this.get(id).state !== "processing") return;
      await rename(
        output,
        path.join(this.store.dir, "pdfs", `${job.hash}.pdf`),
      );
      controller.signal.throwIfAborted();
      if (this.get(id).state !== "processing") return;
      const doc: Document = {
        id: job.hash,
        name: job.name,
        pages,
        indexedPages: 0,
        indexStatus: "indexing",
        page: 1,
        rotation: 0,
        zoom: 0,
        fitMode: "page",
        sourceFormat: job.format,
        importEngine: engine,
        createdAt: new Date().toISOString(),
      };
      this.store.put("document", doc);
      this.save({ ...job, state: "completed", documentId: doc.id });
      this.onDocument(doc);
    } catch (e) {
      if (!this.closed && this.get(id).state === "processing") {
        let error = String((e as Error).message || e);
        if (/password|encrypted|密码/i.test(error))
          error = "文件已加密，请先另存为无密码副本";
        else if (/protected|permission|rights|受保护/i.test(error))
          error = "文件受保护，无法生成阅读缓存";
        this.save({
          ...this.get(id),
          state: "failed",
          error: error.slice(0, 700),
        });
      }
    } finally {
      clearTimeout(timer);
      this.running.delete(id);
      // This UUID directory is created only by this job beneath the data directory.
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }
}
