import type { MindMapNode } from "./types.ts";

export const MIND_MAP_NODE_WIDTH = 184;
export const MIND_MAP_NODE_HEIGHT = 64;
export const MIND_MAP_BRANCH_GAP = 260;
export const MIND_MAP_ROW_GAP = 92;
export const MIND_MAP_COLORS = [
  "#8b5543",
  "#3f6f72",
  "#6f7550",
  "#9a6a2f",
  "#6c5f85",
  "#4e6d8d",
];

export interface MindMapPosition {
  x: number;
  y: number;
}

export function mindMapNodeSummary(node: MindMapNode) {
  // Older maps stored their explanation in note; keep it readable without a migration.
  return node.summary?.trim() || node.note?.trim() || "";
}

export function mindMapChildren(nodes: MindMapNode[], parentId: string) {
  return nodes.filter((node) => node.parentId === parentId);
}

export function mindMapDescendants(nodes: MindMapNode[], id: string): Set<string> {
  const found = new Set([id]);
  const visit = (parentId: string) => {
    for (const child of mindMapChildren(nodes, parentId)) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      visit(child.id);
    }
  };
  visit(id);
  return found;
}

export function visibleMindMapNodes(nodes: MindMapNode[], rootId: string) {
  const byParent = new Map<string, MindMapNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = byParent.get(node.parentId) || [];
    children.push(node);
    byParent.set(node.parentId, children);
  }
  const visible: MindMapNode[] = [];
  const visit = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    visible.push(node);
    if (!node.collapsed)
      for (const child of byParent.get(id) || []) visit(child.id);
  };
  visit(rootId);
  return visible;
}

export function validateMindMapNodes(nodes: MindMapNode[], rootId: string) {
  if (!nodes.length || nodes.length > 300)
    throw Error("思维导图节点数量必须在 1 到 300 之间");
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw Error("思维导图包含重复节点");
  const roots = nodes.filter((node) => !node.parentId);
  if (roots.length !== 1 || roots[0].id !== rootId)
    throw Error("思维导图必须有且只有一个根节点");
  for (const node of nodes) {
    if (!node.text.trim()) throw Error("节点标题不能为空");
    if (node.parentId && !ids.has(node.parentId))
      throw Error("节点的父级不存在");
    if (node.parentId === node.id) throw Error("节点不能连接到自身");
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw Error("思维导图不能包含循环连接");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of mindMapChildren(nodes, id)) visit(child.id);
    visiting.delete(id);
    visited.add(id);
  };
  visit(rootId);
  if (visited.size !== nodes.length)
    throw Error("所有节点都必须连接到根节点");
}

export function layoutMindMap(nodes: MindMapNode[], rootId: string) {
  const visible = visibleMindMapNodes(nodes, rootId);
  const visibleIds = new Set(visible.map((node) => node.id));
  const children = new Map<string, MindMapNode[]>();
  for (const node of visible) {
    if (!node.parentId || !visibleIds.has(node.parentId)) continue;
    const list = children.get(node.parentId) || [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const positions = new Map<string, MindMapPosition>();
  const spanCache = new Map<string, number>();
  const span = (id: string): number => {
    if (spanCache.has(id)) return spanCache.get(id)!;
    const value = Math.max(
      1,
      (children.get(id) || []).reduce(
        (sum, child) => sum + span(child.id),
        0,
      ),
    );
    spanCache.set(id, value);
    return value;
  };
  const root = visible.find((node) => node.id === rootId);
  if (!root) return positions;
  positions.set(rootId, {
    x: -MIND_MAP_NODE_WIDTH / 2,
    y: -MIND_MAP_NODE_HEIGHT / 2,
  });
  const rootChildren = children.get(rootId) || [];
  const sideFor = (node: MindMapNode, index: number) =>
    node.side || (index % 2 ? "left" : "right");
  const right = rootChildren.filter(
    (node, index) => sideFor(node, index) === "right",
  );
  const left = rootChildren.filter(
    (node, index) => sideFor(node, index) === "left",
  );
  const placeBranch = (
    node: MindMapNode,
    depth: number,
    side: -1 | 1,
    top: number,
  ) => {
    const branchSpan = span(node.id);
    const centerY = top + (branchSpan * MIND_MAP_ROW_GAP) / 2;
    positions.set(node.id, {
      x: side * depth * MIND_MAP_BRANCH_GAP - MIND_MAP_NODE_WIDTH / 2,
      y: centerY - MIND_MAP_NODE_HEIGHT / 2,
    });
    let cursor = top;
    for (const child of children.get(node.id) || []) {
      placeBranch(child, depth + 1, side, cursor);
      cursor += span(child.id) * MIND_MAP_ROW_GAP;
    }
  };
  const placeSide = (items: MindMapNode[], side: -1 | 1) => {
    const total = items.reduce((sum, node) => sum + span(node.id), 0);
    let cursor = (-total * MIND_MAP_ROW_GAP) / 2;
    for (const node of items) {
      placeBranch(node, 1, side, cursor);
      cursor += span(node.id) * MIND_MAP_ROW_GAP;
    }
  };
  placeSide(right, 1);
  placeSide(left, -1);
  return positions;
}

export function mindMapBounds(positions: Map<string, MindMapPosition>) {
  const values = [...positions.values()];
  if (!values.length)
    return {
      x: 0,
      y: 0,
      width: MIND_MAP_NODE_WIDTH,
      height: MIND_MAP_NODE_HEIGHT,
    };
  const minX = Math.min(...values.map((value) => value.x));
  const minY = Math.min(...values.map((value) => value.y));
  const maxX = Math.max(
    ...values.map((value) => value.x + MIND_MAP_NODE_WIDTH),
  );
  const maxY = Math.max(
    ...values.map((value) => value.y + MIND_MAP_NODE_HEIGHT),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
