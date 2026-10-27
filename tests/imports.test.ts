import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import * as CFB from "cfb";
import { Store } from "../server/store.ts";
import {
  ImportManager,
  fileFormat,
  type convertOffice,
} from "../server/imports.ts";
import type { Document, ImportJob } from "../shared/types.ts";
const fixture = Buffer.from(
  zipSync({
    "[Content_Types].xml": strToU8(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    ),
    "ppt/presentation.xml": strToU8("<p:presentation/>"),
  }),
);
const caps = async () => ({
  powerpoint: true,
  libreoffice: true,
  libreofficePath: "test-only",
});
async function settled(manager: ImportManager, id: string) {
  for (let i = 0; i < 300; i++) {
    const j = manager.get(id);
    if (!["queued", "processing"].includes(j.state)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("test task did not settle");
}
async function started(manager: ImportManager, id: string) {
  for (let i = 0; i < 100; i++) {
    if (manager.get(id).state === "processing") return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("not started");
}
function setup(
  convert: typeof convertOffice,
  capabilities = caps,
  timeout = 180000,
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lecture-import-"));
  const store = new Store(dir);
  const docs: Document[] = [];
  const manager = new ImportManager(
    store,
    (d) => docs.push(d),
    convert,
    capabilities,
    timeout,
  );
  return {
    dir,
    store,
    manager,
    docs,
    clean: () => {
      manager.close();
      store.close();
      assert.ok(
        path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("格式识别拒绝伪装、损坏和加密文件，支持真实 PPTX 容器", () => {
  assert.equal(fileFormat(fixture, "中文 空格.pptx"), "pptx");
  assert.throws(() => fileFormat(Buffer.from("hello"), "fake.pdf"), /请选择/);
  assert.throws(
    () => fileFormat(Buffer.from("PK\u0003\u0004broken"), "bad.pptx"),
    /损坏/,
  );
  assert.throws(() => fileFormat(fixture, "bad.ppt"), /不符/);
  const encrypted = CFB.utils.cfb_new();
  CFB.utils.cfb_add(encrypted, "EncryptedPackage", Buffer.from("secret"));
  assert.throws(
    () =>
      fileFormat(
        Buffer.from(CFB.write(encrypted, { type: "buffer" })),
        "locked.pptx",
      ),
    /加密/,
  );
  const binary = CFB.utils.cfb_new();
  const current = Buffer.alloc(20);
  current.writeUInt32LE(0xf3d1c4df, 12);
  CFB.utils.cfb_add(binary, "Current User", current);
  CFB.utils.cfb_add(binary, "PowerPoint Document", Buffer.from("protected"));
  assert.throws(
    () =>
      fileFormat(
        Buffer.from(CFB.write(binary, { type: "buffer" })),
        "加密.ppt",
      ),
    /加密/,
  );
});
test("取消后立即重试不会被旧任务覆盖，检测引擎期间取消也保持取消状态", async () => {
  let calls = 0;
  const t = setup(async (_i, o, _engine, signal) => {
    calls++;
    if (calls === 1)
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => setTimeout(() => reject(signal.reason), 25),
          { once: true },
        ),
      );
    await copyFile("samples/纯扫描 图形.pdf", o);
    return 1;
  });
  try {
    const j = await t.manager.create(fixture, "A.pptx");
    for (let i = 0; i < 50 && calls === 0; i++)
      await new Promise((r) => setTimeout(r, 5));
    t.manager.cancel(j.id);
    t.manager.retry(j.id);
    const result = await settled(t.manager, j.id);
    assert.equal(result.state, "completed", result.error);
    assert.equal(calls, 2);
  } finally {
    t.clean();
  }
  let executed = false;
  const delayed = setup(
    async () => {
      executed = true;
      return 1;
    },
    async () => {
      await new Promise((r) => setTimeout(r, 50));
      return caps();
    },
  );
  try {
    const j = await delayed.manager.create(fixture, "B.pptx");
    await started(delayed.manager, j.id);
    delayed.manager.cancel(j.id);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(delayed.manager.get(j.id).state, "cancelled");
    assert.equal(executed, false);
  } finally {
    delayed.clean();
  }
});
test("并发重复导入只转换一次，保存来源与原件，旧 PDF 仍可直接导入", async () => {
  let calls = 0;
  const t = setup(async (_i, o) => {
    calls++;
    await copyFile("samples/微积分入门.pdf", o);
    return 5;
  });
  try {
    const [a, b] = await Promise.all([
      t.manager.create(fixture, "课程 1.pptx"),
      t.manager.create(fixture, "课程 1.pptx"),
    ]);
    assert.equal(a.id, b.id);
    const result = await settled(t.manager, a.id);
    assert.equal(result.state, "completed", result.error);
    assert.equal(calls, 1);
    const doc = t.store.document(result.documentId!)!;
    assert.equal(doc.sourceFormat, "pptx");
    assert.equal(doc.importEngine, "powerpoint");
    assert.equal(doc.fitMode, "page");
    assert.equal(doc.pages, 5);
    assert.deepEqual(
      await readFile(path.join(t.dir, "originals", doc.id + ".pptx")),
      fixture,
    );
    const duplicate = await t.manager.create(fixture, "renamed.pptx");
    assert.equal(duplicate.documentId, doc.id);
    assert.equal(calls, 1);
    const pdf = await t.manager.create(
      readFileSync("samples/纯扫描 图形.pdf"),
      "扫描件.pdf",
    );
    assert.equal((await settled(t.manager, pdf.id)).state, "completed");
    assert.equal(calls, 1);
  } finally {
    t.clean();
  }
});
test("运行中及排队的任务可以取消，取消后不会提交文档", async () => {
  let entered = 0;
  const t = setup(async (_i, _o, _engine, signal) => {
    entered++;
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
    return 1;
  });
  try {
    const a = await t.manager.create(fixture, "A.pptx");
    await started(t.manager, a.id);
    const b = await t.manager.create(
      Buffer.concat([fixture, Buffer.from("different")]),
      "B.pptx",
    );
    t.manager.cancel(b.id);
    t.manager.cancel(a.id);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(t.manager.get(a.id).state, "cancelled");
    assert.equal(t.manager.get(b.id).state, "cancelled");
    assert.equal(entered, 1);
    assert.equal(t.docs.length, 0);
  } finally {
    t.clean();
  }
});
test("超时、引擎缺失、保护错误明确失败；兼容引擎只在手动重试后运行", async () => {
  const engines: string[] = [];
  const t = setup(async (_i, o, engine) => {
    engines.push(engine);
    if (engine === "powerpoint") throw Error("PROTECTED: protected document");
    await copyFile("samples/纯扫描 图形.pdf", o);
    return 1;
  });
  try {
    const a = await t.manager.create(fixture, "A.pptx");
    let result = await settled(t.manager, a.id);
    assert.equal(result.state, "failed");
    assert.match(result.error!, /受保护/);
    assert.deepEqual(engines, ["powerpoint"]);
    t.manager.retry(a.id, "libreoffice");
    result = await settled(t.manager, a.id);
    assert.equal(result.state, "completed", result.error);
    assert.deepEqual(engines, ["powerpoint", "libreoffice"]);
  } finally {
    t.clean();
  }
  const missing = setup(
    async () => {
      throw Error("should not call");
    },
    async () => ({
      powerpoint: false,
      libreoffice: false,
      libreofficePath: "",
    }),
  );
  try {
    const j = await missing.manager.create(fixture, "A.pptx");
    assert.match((await settled(missing.manager, j.id)).error!, /未找到/);
  } finally {
    missing.clean();
  }
  const timed = setup(
    async (_i, _o, _e, signal) => {
      await new Promise<void>((_r, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
      return 1;
    },
    caps,
    30,
  );
  try {
    const j = await timed.manager.create(fixture, "A.pptx");
    assert.match((await settled(timed.manager, j.id)).error!, /超时/);
    assert.equal(timed.docs.length, 0);
  } finally {
    timed.clean();
  }
});
test("引擎自动选择、页数不符拒绝提交、重启中断不会自动重试", async () => {
  const t = setup(
    async (_i, o, engine) => {
      assert.equal(engine, "libreoffice");
      await copyFile("samples/纯扫描 图形.pdf", o);
      return 2;
    },
    async () => ({
      powerpoint: false,
      libreoffice: true,
      libreofficePath: "test",
    }),
  );
  try {
    const j = await t.manager.create(fixture, "A.pptx");
    assert.match((await settled(t.manager, j.id)).error!, /页数/);
    assert.equal(t.docs.length, 0);
    t.store.put<ImportJob>("import", {
      ...t.manager.get(j.id),
      state: "processing",
    });
    const restored = new ImportManager(t.store, () => {
      throw Error("must not auto replay");
    });
    assert.equal(restored.get(j.id).state, "failed");
    assert.match(restored.get(j.id).error!, /中断/);
    restored.close();
  } finally {
    t.clean();
  }
});
