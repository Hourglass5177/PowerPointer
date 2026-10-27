import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { Rect } from "../shared/types.ts";
import { clampPixelRect } from "../shared/geometry.ts";
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const require = createRequire(import.meta.url);
export const pdfAssets = path.dirname(
  require.resolve("pdfjs-dist/package.json"),
);
const assetDir = (name: string) =>
  path.join(pdfAssets, name).replaceAll("\\", "/") + "/";
export async function openPdf(file: string) {
  return pdfjs.getDocument({
    data: new Uint8Array(await readFile(file)),
    useSystemFonts: true,
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetDir("standard_fonts"),
    wasmUrl: assetDir("wasm"),
  }).promise;
}
export async function renderPage(
  file: string,
  pageNum: number,
  rotation = 0,
  rect?: Rect,
  maxSide = 2100,
) {
  const pdf = await openPdf(file);
  try {
    const p = await pdf.getPage(pageNum);
    const base = p.getViewport({
      scale: 1,
      rotation: (p.rotate + rotation) % 360,
    });
    const scale = Math.min(3, maxSide / Math.max(base.width, base.height));
    const viewport = p.getViewport({
      scale,
      rotation: (p.rotate + rotation) % 360,
    });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await p.render({
      canvas: canvas as any,
      canvasContext: canvas.getContext("2d") as any,
      viewport,
    }).promise;
    if (!rect) return canvas.toBuffer("image/png");
    const r = clampPixelRect(
      viewport.convertToViewportRectangle(rect),
      canvas.width,
      canvas.height,
    );
    const w = r[2] - r[0],
      h = r[3] - r[1];
    if (w < 2 || h < 2) throw Error("框选范围太小或超出页面");
    const crop = createCanvas(w, h);
    crop.getContext("2d").drawImage(canvas, r[0], r[1], w, h, 0, 0, w, h);
    return crop.toBuffer("image/png");
  } finally {
    await pdf.destroy();
  }
}
