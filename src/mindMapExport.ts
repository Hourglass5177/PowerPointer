import type { MindMap } from "../shared/types.ts";
import {
  MIND_MAP_NODE_HEIGHT,
  MIND_MAP_NODE_WIDTH,
  mindMapBounds,
  type MindMapPosition,
} from "../shared/mind-map.ts";

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "思维导图";
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function lines(value: string) {
  const result: string[] = [];
  let current = "";
  for (const char of value) {
    current += char;
    if (current.length >= 13) {
      result.push(current);
      current = "";
    }
  }
  if (current) result.push(current);
  return result.slice(0, 2);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportMindMapJson(map: MindMap) {
  download(
    new Blob([JSON.stringify(map, null, 2)], { type: "application/json" }),
    `${safeName(map.title)}.json`,
  );
}

export function exportMindMapMarkdown(map: MindMap) {
  const output = [`# ${map.title}`, ""];
  const visit = (id: string, depth: number) => {
    const node = map.nodes.find(item => item.id === id);
    if (!node) return;
    const indent = "  ".repeat(depth);
    output.push(`${indent}- ${node.text.replaceAll("\n", " ")}`);
    if (node.summary) output.push(`${indent}  知识简介：${node.summary.replaceAll("\n", `\n${indent}  `)}`);
    if (node.note) output.push(`${indent}  ${node.note.replaceAll("\n", `\n${indent}  `)}`);
    if (node.source) output.push(`${indent}  来源：${node.source.documentName || node.source.documentId} · 第 ${node.source.page} 页`);
    if (node.link) output.push(`${indent}  ${node.link}`);
    for (const child of map.nodes.filter(item => item.parentId === id)) visit(child.id, depth + 1);
  };
  visit(map.rootId, 0);
  download(new Blob([output.join("\n")], { type: "text/markdown;charset=utf-8" }), `${safeName(map.title)}.md`);
}

export function createMindMapSvg(
  map: MindMap,
  positions: Map<string, MindMapPosition>,
) {
  const visible = map.nodes.filter((node) => positions.has(node.id));
  const bounds = mindMapBounds(positions);
  const padding = 48;
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const offsetX = padding - bounds.x;
  const offsetY = padding - bounds.y;
  const background = map.theme === "mono" ? "#f8f8f6" : "#fbfaf6";
  const edges = visible
    .filter((node) => node.parentId && positions.has(node.parentId))
    .map((node) => {
      const child = positions.get(node.id)!;
      const parent = positions.get(node.parentId!)!;
      const right = child.x > parent.x;
      const startX = parent.x + (right ? MIND_MAP_NODE_WIDTH : 0) + offsetX;
      const startY = parent.y + MIND_MAP_NODE_HEIGHT / 2 + offsetY;
      const endX = child.x + (right ? 0 : MIND_MAP_NODE_WIDTH) + offsetX;
      const endY = child.y + MIND_MAP_NODE_HEIGHT / 2 + offsetY;
      const bend = (startX + endX) / 2;
      return `<path d="M ${startX} ${startY} C ${bend} ${startY}, ${bend} ${endY}, ${endX} ${endY}" fill="none" stroke="${escapeXml(node.color || "#8b5543")}" stroke-width="2" opacity="0.7"/>`;
    })
    .join("");
  const nodes = visible
    .map((node) => {
      const position = positions.get(node.id)!;
      const x = position.x + offsetX;
      const y = position.y + offsetY;
      const root = node.id === map.rootId;
      const fill = root
        ? node.color || "#8b5543"
        : map.theme === "colorful"
          ? node.color || "#ffffff"
          : "#ffffff";
      const stroke = node.color || "#8b5543";
      const textColor = root ? "#ffffff" : "#2f302d";
      const text = lines(node.text)
        .map(
          (line, index, all) =>
            `<tspan x="${x + MIND_MAP_NODE_WIDTH / 2}" dy="${index ? 17 : -(all.length - 1) * 8.5}">${escapeXml(line)}</tspan>`,
        )
        .join("");
      return `<g><rect x="${x}" y="${y}" width="${MIND_MAP_NODE_WIDTH}" height="${MIND_MAP_NODE_HEIGHT}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="${root ? 0 : 1.5}"/><text x="${x + MIND_MAP_NODE_WIDTH / 2}" y="${y + MIND_MAP_NODE_HEIGHT / 2 + 5}" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="14" font-weight="${root ? 600 : 500}" fill="${textColor}">${text}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/>${edges}${nodes}</svg>`;
}

export function exportMindMapSvg(
  map: MindMap,
  positions: Map<string, MindMapPosition>,
) {
  download(
    new Blob([createMindMapSvg(map, positions)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    `${safeName(map.title)}.svg`,
  );
}

export async function exportMindMapPng(
  map: MindMap,
  positions: Map<string, MindMapPosition>,
) {
  const svg = createMindMapSvg(map, positions);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const scale = Math.min(2, 12000 / image.width, 12000 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(image.width * scale);
    canvas.height = Math.ceil(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw Error("当前浏览器不能导出 PNG");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    const output = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(Error("PNG 导出失败"))),
        "image/png",
      ),
    );
    download(output, `${safeName(map.title)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
