import type { Rect } from "./types.ts";
export function normalizedRect(a: number[], b: number[]): Rect {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ];
}
export function clampPixelRect(
  rect: number[],
  width: number,
  height: number,
): Rect {
  const r = normalizedRect(rect.slice(0, 2), rect.slice(2));
  return [
    Math.max(0, Math.floor(r[0])),
    Math.max(0, Math.floor(r[1])),
    Math.min(width, Math.ceil(r[2])),
    Math.min(height, Math.ceil(r[3])),
  ];
}
