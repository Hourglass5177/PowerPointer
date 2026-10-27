import { PDFDocument, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
mkdirSync("samples", { recursive: true });
const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(readFileSync("C:/Windows/Fonts/simhei.ttf"), {
  subset: true,
});
const lines = [
  [
    "函数与变化率",
    "导数的定义：函数在一点的瞬时变化率。",
    "若 f(x)=x^2，则 f′(x)=2x。",
    "本页为定义；第 3 页给出例子。",
  ],
  [
    "从差商到导数",
    "f(x+h)-f(x) = 2xh+h^2",
    "[f(x+h)-f(x)]/h = 2x+h",
    "当 h 趋近于 0，得到 f′(x)=2x。",
  ],
  [
    "例子与几何意义",
    "当 x=3，函数 y=x^2 的切线斜率为 6。",
    "请结合第 1 页导数定义解释。",
    "图形：蓝色曲线表示 y=x^2。",
  ],
];
for (let i = 0; i < 3; i++) {
  const p = pdf.addPage([960, 540]);
  p.drawRectangle({
    x: 0,
    y: 0,
    width: 960,
    height: 540,
    color: rgb(0.97, 0.98, 1),
  });
  lines[i].forEach((t, j) =>
    p.drawText(t, {
      x: 65,
      y: 455 - j * 75,
      size: j ? 25 : 38,
      font,
      color: rgb(0.08, 0.19, 0.28),
    }),
  );
  if (i === 2) {
    for (let x = 0; x < 140; x += 3)
      p.drawCircle({
        x: 650 + x,
        y: 100 + (x * x) / 90,
        size: 2,
        color: rgb(0.1, 0.4, 0.7),
      });
  }
  p.drawText(`PDF ${i + 1}`, { x: 820, y: 25, size: 16, font });
}
GlobalFonts.registerFromPath("C:/Windows/Fonts/simhei.ttf", "SampleChinese");
const scan = createCanvas(1600, 900),
  ctx = scan.getContext("2d");
ctx.fillStyle = "#fff9eb";
ctx.fillRect(0, 0, 1600, 900);
ctx.fillStyle = "#243f42";
ctx.font = "56px SampleChinese";
ctx.fillText("扫描示例：三个红圆，一个蓝色三角形", 90, 130);
ctx.fillText("图中口令：枫叶 729", 90, 240);
ctx.fillStyle = "#d34242";
for (let i = 0; i < 3; i++) {
  ctx.beginPath();
  ctx.arc(230 + i * 330, 480, 95, 0, Math.PI * 2);
  ctx.fill();
}
ctx.fillStyle = "#367bc7";
ctx.beginPath();
ctx.moveTo(1100, 650);
ctx.lineTo(1250, 350);
ctx.lineTo(1400, 650);
ctx.fill();
const scanBytes = scan.toBuffer("image/png");
const image = await pdf.embedPng(scanBytes);
const page = pdf.addPage([960, 540]);
page.drawImage(image, { x: 0, y: 0, width: 960, height: 540 });
const rotated = pdf.addPage([540, 960]);
rotated.setRotation(degrees(90));
rotated.drawText("旋转页面测试：坐标与裁图", { x: 35, y: 850, size: 25, font });
writeFileSync("samples/微积分入门.pdf", await pdf.save());
const only = await PDFDocument.create(),
  img = await only.embedPng(scanBytes);
only
  .addPage([960, 540])
  .drawImage(img, { x: 0, y: 0, width: 960, height: 540 });
writeFileSync("samples/纯扫描 图形.pdf", await only.save());
console.log("Created sample PDFs");
