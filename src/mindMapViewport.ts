export type MindMapViewport = { x: number; y: number; zoom: number };
export type MindMapPan = { pointerId: number; clientX: number; clientY: number; x: number; y: number };

export function panViewportUpdate(
  pan: { current: MindMapPan | undefined },
  pointer: { pointerId: number; clientX: number; clientY: number },
): ((current: MindMapViewport) => MindMapViewport) | undefined {
  const state = pan.current;
  if (!state || state.pointerId !== pointer.pointerId) return;
  // Snapshot coordinates now: React can run this updater after the gesture ends.
  const x = state.x + pointer.clientX - state.clientX;
  const y = state.y + pointer.clientY - state.clientY;
  return current => ({ ...current, x, y });
}

export function zoomViewport(current: MindMapViewport, point: { x: number; y: number }, deltaY: number): MindMapViewport {
  const zoom = Math.max(0.2, Math.min(2.5, current.zoom * Math.exp(-deltaY * 0.0012)));
  const ratio = zoom / current.zoom;
  return { zoom, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
}
