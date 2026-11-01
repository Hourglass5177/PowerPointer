import test from "node:test";
import assert from "node:assert/strict";
import { panViewportUpdate, zoomViewport, type MindMapPan } from "../src/mindMapViewport.ts";

test("queued pan survives pointer release and a new gesture without losing a newer zoom", () => {
  const pan: { current: MindMapPan | undefined } = { current: { pointerId: 1, clientX: 100, clientY: 200, x: 30, y: 40 } };
  const pointer = { pointerId: 1, clientX: 145, clientY: 180 };
  const queued = panViewportUpdate(pan, pointer)!;
  // React may process a continuous pointermove after pointerup clears the ref.
  pan.current = undefined;
  assert.deepEqual(queued({ x: 30, y: 40, zoom: 1.5 }), { x: 75, y: 20, zoom: 1.5 });
  pan.current = { pointerId: 1, clientX: 500, clientY: 600, x: -90, y: -80 };
  pointer.clientX = 900;
  assert.deepEqual(queued({ x: 0, y: 0, zoom: 2 }), { x: 75, y: 20, zoom: 2 });
  assert.equal(panViewportUpdate(pan, { pointerId: 2, clientX: 0, clientY: 0 }), undefined);
  pan.current = undefined;
  assert.equal(panViewportUpdate(pan, pointer), undefined);
});

test("queued wheel zoom accumulates at the cursor and respects both limits", () => {
  const before = { x: -40, y: 30, zoom: 0.8 }, point = { x: 360, y: 190 };
  const first = zoomViewport(before, point, -120);
  const second = zoomViewport(first, point, -120);
  assert.ok(second.zoom > first.zoom);
  for (const next of [first, second, zoomViewport(before, point, -1e6), zoomViewport(before, point, 1e6)]) {
    assert.ok(next.zoom >= 0.2 && next.zoom <= 2.5);
    assert.ok(Math.abs((point.x - before.x) / before.zoom - (point.x - next.x) / next.zoom) < 1e-9);
    assert.ok(Math.abs((point.y - before.y) / before.zoom - (point.y - next.y) / next.zoom) < 1e-9);
  }
  assert.equal(zoomViewport(before, point, -1e6).zoom, 2.5);
  assert.equal(zoomViewport(before, point, 1e6).zoom, 0.2);
});
