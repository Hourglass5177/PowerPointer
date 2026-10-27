import { randomUUID, createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  Course,
  CourseFile,
  DirectoryChange,
  Document,
} from "../shared/types.ts";
import type { Store } from "./store.ts";
import type { ImportManager } from "./imports.ts";

export function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export async function scanDirectory(root: string): Promise<CourseFile[]> {
  const canonical = await realpath(root),
    files: CourseFile[] = [];
  if (!(await stat(canonical)).isDirectory()) throw Error("请选择一个目录");
  const walk = async (folder: string, depth: number) => {
    if (depth > 24) throw Error("目录层级超过 24 层，请选择更具体的课程目录");
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(folder, entry.name),
        actual = await realpath(full);
      if (!inside(canonical, actual)) continue;
      if (entry.isDirectory()) await walk(actual, depth + 1);
      else if (entry.isFile() && /\.(pdf|pptx?)$/i.test(entry.name)) {
        const info = await stat(actual);
        if (info.size > 100 * 1024 * 1024)
          throw Error(`${entry.name} 超过 100 MB，请将大文件移到课程目录之外`);
        const bytes = await readFile(actual);
        files.push({
          path: path.relative(canonical, full),
          hash: createHash("sha256").update(bytes).digest("hex"),
          size: info.size,
          modifiedAt: info.mtimeMs,
          selected: false,
        });
        if (files.length > 2000)
          throw Error("目录超过 2000 份课件，请选择更具体的目录");
      }
    }
  };
  await walk(canonical, 0);
  return files.sort((a, b) =>
    a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
  );
}
export function directoryChanges(
  previous: CourseFile[],
  current: CourseFile[],
): DirectoryChange[] {
  const old = new Map(previous.map((f) => [f.path, f])),
    next = new Map(current.map((f) => [f.path, f]));
  const removed = previous.filter((f) => !next.has(f.path)),
    used = new Set<string>();
  const changes: DirectoryChange[] = [];
  for (const file of current) {
    const before = old.get(file.path);
    if (before?.hash === file.hash) continue;
    const moved = before
      ? undefined
      : removed.find((f) => f.hash === file.hash && !used.has(f.path));
    if (moved) used.add(moved.path);
    changes.push({
      ...file,
      type: before ? "modified" : moved ? "moved" : "added",
      from: moved?.path,
    });
  }
  for (const file of removed)
    if (!used.has(file.path))
      changes.push({ path: file.path, type: "deleted" });
  return changes;
}
export class CourseService {
  private watchers = new Map<string, FSWatcher>();
  private pending = new Map<string, Promise<Course>>();
  private syncing = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private periodic: ReturnType<typeof setInterval>;
  constructor(
    private store: Store,
    private imports: ImportManager,
    private notify: () => void,
  ) {
    // Recover completed imports whose course update was interrupted by shutdown.
    for (const doc of store.all<Document>("document")) this.imported(doc);
    this.periodic = setInterval(() => {
      for (const c of this.list())
        if (c.root) void this.scan(c.id).catch(() => {});
    }, 60000);
    this.periodic.unref();
    for (const c of this.list())
      if (c.root) {
        this.listen(c);
        void this.scan(c.id).catch(() => {});
      }
  }
  list() {
    return this.store.all<Course>("course");
  }
  get(id: string) {
    const c = this.store.get<Course>("course", id);
    if (!c) throw Error("课程不存在");
    return c;
  }
  save(c: Course) {
    this.store.put("course", c);
    this.notify();
    return c;
  }
  create(name: string, documentIds: string[] = []) {
    if (documentIds.some((id) => !this.store.document(id)))
      throw Error("课件不存在");
    const now = new Date().toISOString();
    return this.save({
      id: randomUUID(),
      name,
      files: [],
      documentIds,
      selectedDocumentIds: documentIds,
      changes: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  patch(
    id: string,
    patch: {
      name?: string;
      documentIds?: string[];
      selectedDocumentIds?: string[];
      groups?: Course["groups"];
      displayNames?: Course["displayNames"];
      readingPosition?: Course["readingPosition"];
    },
  ) {
    const c = this.get(id),
      ids = patch.documentIds || c.documentIds,
      selected =
        patch.selectedDocumentIds ||
        c.selectedDocumentIds.filter((x) => ids.includes(x));
    if (
      ids.some((x) => !this.store.document(x)) ||
      selected.some((x) => !ids.includes(x))
    )
      throw Error("课程资料选择无效");
    if (patch.groups) {
      const grouped = patch.groups.flatMap(g => g.documentIds);
      if (grouped.some(x => !ids.includes(x)) || new Set(grouped).size !== grouped.length || new Set(patch.groups.map(g => g.id)).size !== patch.groups.length) throw Error("章节分组包含重复或无效资料");
    }
    if (patch.displayNames && Object.keys(patch.displayNames).some(x => !ids.includes(x))) throw Error("章节名称对应的资料不存在");
    if (patch.readingPosition && (!ids.includes(patch.readingPosition.documentId) || patch.readingPosition.page > this.store.document(patch.readingPosition.documentId)!.pages)) throw Error("课程阅读位置无效");
    const changed =
      JSON.stringify(selected) !== JSON.stringify(c.selectedDocumentIds);
    return this.save({
      ...c,
      ...patch,
      files: c.files.map((f) =>
        f.documentId && c.documentIds.includes(f.documentId) && !ids.includes(f.documentId)
          ? { ...f, selected: false }
          : f,
      ),
      documentIds: [...new Set(ids)],
      selectedDocumentIds: [...new Set(selected)],
      groups: (patch.groups || c.groups)?.map(g => ({ ...g, documentIds: g.documentIds.filter(x => ids.includes(x)) })),
      displayNames: Object.fromEntries(Object.entries(patch.displayNames || c.displayNames || {}).filter(([x]) => ids.includes(x))),
      readingPosition: patch.readingPosition ? { ...patch.readingPosition, updatedAt: new Date().toISOString() } : c.readingPosition && ids.includes(c.readingPosition.documentId) ? c.readingPosition : undefined,
      knowledgeStale: c.knowledgeStale || changed,
      updatedAt: new Date().toISOString(),
    });
  }
  async bind(id: string, root: string) {
    if (this.syncing.has(id)) throw Error("课程正在同步，请稍后重试");
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory()) throw Error("目录不存在");
    const c = this.save({
      ...this.get(id),
      root: canonical,
      offline: undefined,
      changes: [],
      scanId: undefined,
    });
    this.listen(c);
    return this.scan(id);
  }
  unbind(id: string) {
    if (this.syncing.has(id)) throw Error("课程正在同步，请稍后重试");
    this.watchers.get(id)?.close();
    this.watchers.delete(id);
    return this.save({
      ...this.get(id),
      root: undefined,
      changes: [],
      offline: undefined,
      scanId: undefined,
    });
  }
  private listen(c: Course) {
    this.watchers.get(c.id)?.close();
    if (!c.root) return;
    try {
      const watcher = watch(c.root, { recursive: true }, () => {
        clearTimeout(this.timers.get(c.id));
        this.timers.set(
          c.id,
          setTimeout(() => void this.scan(c.id).catch(() => {}), 1500),
        );
      });
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(c.id);
        void this.scan(c.id).catch(() => {});
      });
      this.watchers.set(c.id, watcher);
    } catch {
      /* Startup/manual/periodic scans remain authoritative. */
    }
  }
  scan(id: string): Promise<Course> {
    const pending = this.pending.get(id);
    if (pending) return pending;
    const work = this.scanNow(id).finally(() => this.pending.delete(id));
    this.pending.set(id, work);
    return work;
  }
  private async scanNow(id: string) {
    const c = this.get(id);
    if (!c.root) return c;
    try {
      const files = await scanDirectory(c.root),
        latest = this.get(id);
      if (latest.root !== c.root) return latest;
      const changes = directoryChanges(latest.files, files);
      const scanId = createHash("sha256")
        .update(JSON.stringify(changes))
        .digest("hex");
      if (!this.watchers.has(id)) this.listen(latest);
      return this.save({
        ...latest,
        changes,
        scanId,
        checkedAt: new Date().toISOString(),
        offline: undefined,
      });
    } catch (e) {
      return this.save({
        ...this.get(id),
        checkedAt: new Date().toISOString(),
        offline: `目录暂不可访问：${(e as Error).message}`,
      });
    }
  }
  async sync(id: string, scanId: string, selectedPaths: string[]) {
    if (this.syncing.has(id)) throw Error("课程正在同步，请稍后重试");
    this.syncing.add(id);
    try {
      const c = await this.scan(id);
      if (c.offline || !c.root) throw Error(c.offline || "请先绑定目录");
      if (c.scanId !== scanId)
        throw Error("目录已再次变化，请检查新的变更清单后同步");
      const current = await scanDirectory(c.root);
      if (
        createHash("sha256")
          .update(JSON.stringify(directoryChanges(c.files, current)))
          .digest("hex") !== scanId
      )
        throw Error("目录已再次变化，请刷新后同步");
      if (selectedPaths.some((p) => !current.some((f) => f.path === p)))
        throw Error("所选文件不存在");
      const oldIds = new Set(
        c.files.filter((f) => f.documentId).map((f) => f.documentId!),
      );
      const files: CourseFile[] = [];
      for (const file of current) {
        const before = c.files.find((f) => f.hash === file.hash),
          selected = selectedPaths.includes(file.path);
        const next = { ...file, selected, documentId: before?.documentId, importJobId: before?.importJobId };
        if (
          selected &&
          (!next.documentId || !this.store.document(next.documentId))
        ) {
          const full = await realpath(path.join(c.root, file.path));
          if (!inside(c.root, full)) throw Error("文件已移出绑定目录");
          const bytes = await readFile(full);
          if (createHash("sha256").update(bytes).digest("hex") !== file.hash)
            throw Error("文件正在修改，请稍后刷新并重试");
          const job = await this.imports.create(
            bytes,
            path.basename(file.path),
          );
          Object.assign(next, {
            importJobId: job.id,
            documentId: job.documentId,
          });
        }
        files.push(next);
      }
      // A directory sync changes course membership only. Old immutable versions remain in the library.
      const retained = c.documentIds.filter((x) => !oldIds.has(x));
      const imported = files
        .filter((f) => f.selected && f.documentId)
        .map((f) => f.documentId!);
      const saved = this.save({
        ...this.get(id),
        files,
        documentIds: [...c.documentIds.filter(x => retained.includes(x) || imported.includes(x)), ...imported.filter(x => !c.documentIds.includes(x))],
        selectedDocumentIds: [
          ...new Set([
            ...c.selectedDocumentIds.filter((x) => retained.includes(x)),
            ...imported.filter((id) => !c.documentIds.includes(id) || c.selectedDocumentIds.includes(id)),
          ]),
        ],
        changes: [],
        scanId: undefined,
        knowledgeStale: true,
        updatedAt: new Date().toISOString(),
      });
      for (const file of saved.files)
        if (file.selected && this.store.document(file.hash))
          this.imported(this.store.document(file.hash)!);
      return this.get(id);
    } finally {
      this.syncing.delete(id);
    }
  }
  imported(doc: Document) {
    for (const c of this.list()) {
      const matches = c.files.filter((f) => f.hash === doc.id && f.selected);
      if (!matches.length) continue;
      if (c.documentIds.includes(doc.id) && matches.every((f) => f.documentId === doc.id)) continue;
      const added = !c.documentIds.includes(doc.id);
      const documentIds = [...c.documentIds];
      if (added) {
        const position = c.files.findIndex(f => f.hash === doc.id);
        const following = c.files.slice(position + 1).find(f => f.documentId && documentIds.includes(f.documentId));
        const index = following?.documentId ? documentIds.indexOf(following.documentId) : documentIds.length;
        documentIds.splice(index, 0, doc.id);
      }
      this.save({
        ...c,
        files: c.files.map((f) =>
          f.hash === doc.id ? { ...f, documentId: doc.id } : f,
        ),
        documentIds,
        selectedDocumentIds: added ? [...new Set([...c.selectedDocumentIds, doc.id])] : c.selectedDocumentIds,
        knowledgeStale: c.knowledgeStale || added,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  close() {
    clearInterval(this.periodic);
    for (const t of this.timers.values()) clearTimeout(t);
    for (const w of this.watchers.values()) w.close();
  }
}
