import { Codex } from "../server/codex.ts";
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const dir = path.resolve("data");
mkdirSync(path.join(dir, "verification"), { recursive: true });
const c = createCanvas(1000, 600),
  x = c.getContext("2d");
x.fillStyle = "white";
x.fillRect(0, 0, 1000, 600);
x.fillStyle = "#153a72";
x.font = "bold 72px sans-serif";
x.fillText("ORBIT 5831", 90, 110);
x.fillStyle = "#e14438";
for (let i = 0; i < 3; i++) {
  x.beginPath();
  x.arc(180 + i * 220, 320, 60, 0, Math.PI * 2);
  x.fill();
}
x.fillStyle = "#153a72";
x.font = "42px sans-serif";
x.fillText("y = 2x + 7", 100, 520);
const img = path.join(dir, "verification", "vision.png");
writeFileSync(img, c.toBuffer("image/png"));
let ai = new Codex(dir);
const record: any = { date: new Date().toISOString(), checks: [] };
try {
  record.auth = await ai.status();
  const models = await ai.models();
  const model = (
    models.find((m) => m.isDefault && m.inputModalities?.includes("image")) ||
    models.find((m) => m.inputModalities?.includes("image"))
  )?.model;
  if (!model) throw Error("没有可用视觉模型");
  record.model = model;
  record.version = ai.version;
  const thread = await ai.thread(model);
  record.thread = thread;
  const check = async (
    name: string,
    prompt: string,
    images: string[],
    test: (s: string) => boolean,
  ) => {
    const r = await ai.run(thread, prompt, images, () => {});
    record.checks.push({
      name,
      ...r,
      passed: r.status === "completed" && test(r.text),
    });
    console.log(JSON.stringify(record.checks.at(-1)));
    if (!record.checks.at(-1).passed) throw Error(name + " failed");
  };
  await check(
    "text",
    "计算 17 × 23，只给结果。请记住本轮学习口令为“松叶”。",
    [],
    (s) => s.includes("391"),
  );
  await check(
    "vision",
    "读取图片：写出顶部文字、红色圆形的数量、底部公式。不要调用工具。",
    [img],
    (s) => s.includes("5831") && /3|三/.test(s) && /2\s*x|2x/.test(s),
  );
  await check(
    "followup",
    "刚才图片中公式在 x=4 时的 y 是多少？只回答数值。",
    [],
    (s) => s.includes("15"),
  );
  ai.close();
  ai = new Codex(dir);
  await ai.thread(model, thread);
  await check("resume", "第一轮让你记住的学习口令是什么？只给口令。", [], (s) =>
    s.includes("松叶"),
  );
} catch (e) {
  record.error = String(e);
  console.error(e);
  process.exitCode = 1;
} finally {
  ai.close();
  writeFileSync(
    path.join(dir, "verification", "real-ai.json"),
    JSON.stringify(record, null, 2),
  );
}
