import test from "node:test";
import assert from "node:assert/strict";
import {
  WheelPager,
  wheelZoom,
  readingShortcut,
  type WheelSample,
} from "../src/readingInteractions.ts";

const sample = (patch: Partial<WheelSample> = {}): WheelSample => ({
  time: 0,
  deltaX: 0,
  deltaY: 60,
  deltaMode: 0,
  height: 700,
  top: 0,
  maxTop: 0,
  page: 5,
  pages: 10,
  ...patch,
});
test("wheel accumulates a threshold, consumes inertia, then accepts a new gesture", () => {
  const p = new WheelPager();
  assert.equal(p.feed(sample({ deltaY: 25 })), 0);
  assert.equal(p.feed(sample({ time: 30, deltaY: 35 })), 1);
  for (const time of [60, 150, 300, 450, 600])
    assert.equal(p.feed(sample({ time, page: 6 })), 0);
  assert.equal(p.feed(sample({ time: 800, page: 6 })), 1);
});
test("reaching the edge in a scrolling gesture cannot turn the page", () => {
  const p = new WheelPager();
  assert.equal(p.feed(sample({ maxTop: 900, top: 700 })), 0);
  assert.equal(p.feed(sample({ time: 80, maxTop: 900, top: 900 })), 0);
  assert.equal(p.feed(sample({ time: 280, maxTop: 900, top: 900 })), 1);
});
test("reverse direction requires a fresh gesture and preserves page boundaries", () => {
  const p = new WheelPager();
  assert.equal(p.feed(sample({ deltaY: 25 })), 0);
  assert.equal(p.feed(sample({ time: 30, deltaY: -90 })), 0);
  assert.equal(p.feed(sample({ time: 230, deltaY: -90 })), -1);
  p.reset();
  assert.equal(p.feed(sample({ page: 1, deltaY: -90 })), 0);
  assert.equal(p.feed(sample({ time: 200, page: 10 })), 0);
});
test("wheel normalizes lines and pages and ignores horizontal or blocked gestures", () => {
  const p = new WheelPager();
  assert.equal(p.feed(sample({ deltaMode: 1, deltaY: 4 })), 1);
  p.reset();
  assert.equal(p.feed(sample({ deltaMode: 2, deltaY: 1 })), 1);
  p.reset();
  assert.equal(p.feed(sample({ deltaX: 100 })), 0);
  assert.equal(p.feed(sample({ time: 30 })), 0);
  assert.equal(p.feed(sample({ time: 230, blocked: true })), 0);
  assert.equal(p.feed(sample({ time: 250 })), 0);
  assert.equal(p.feed(sample({ time: 450 })), 1);
});
test("cooldown and rendering both block repeated turns", () => {
  const p = new WheelPager();
  assert.equal(p.feed(sample()), 1);
  assert.equal(p.feed(sample({ time: 200 })), 0);
  assert.equal(p.feed(sample({ time: 400, blocked: true })), 0);
  assert.equal(p.feed(sample({ time: 450 })), 0);
  assert.equal(p.feed(sample({ time: 700 })), 1);
});

const key = (key: string, patch: Partial<KeyboardEvent> = {}) => ({
  key,
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  repeat: false,
  defaultPrevented: false,
  ...patch,
});
const context = {
  active: true,
  blocked: false,
  pageFocused: true,
  singleKeys: true,
};
test("reading tools work outside page focus, navigation does not", () => {
  const c = { ...context, pageFocused: false };
  for (const [k, action] of [
    ["v", "text"],
    ["b", "box"],
    ["g", "jump"],
    ["+", "zoomIn"],
    ["-", "zoomOut"],
    ["0", "fitPage"],
    ["?", "help"],
  ])
    assert.equal(readingShortcut(key(k), c), action);
  for (const k of ["ArrowRight", "ArrowDown", "PageDown", "Home", "End"])
    assert.equal(readingShortcut(key(k), c), undefined);
  assert.equal(readingShortcut(key("f", { ctrlKey: true }), c), "search");
  assert.equal(readingShortcut(key("f", { metaKey: true }), c), "search");
  assert.equal(
    readingShortcut(key(")", { shiftKey: true, code: "Digit0" }), c),
    "fitWidth",
  );
});
test("editing, composition, other workspaces and handled events never trigger shortcuts", () => {
  for (const k of ["b", "g", "ArrowRight", "?", "0"]) {
    assert.equal(
      readingShortcut(key(k), { ...context, blocked: true }),
      undefined,
    );
    assert.equal(
      readingShortcut(key(k), { ...context, active: false }),
      undefined,
    );
    assert.equal(
      readingShortcut(key(k, { isComposing: true }), context),
      undefined,
    );
    assert.equal(
      readingShortcut(key(k, { defaultPrevented: true }), context),
      undefined,
    );
    assert.equal(readingShortcut(key(k, { altKey: true }), context), undefined);
  }
  assert.equal(
    readingShortcut(key("b", { ctrlKey: true }), context),
    undefined,
  );
  assert.equal(
    readingShortcut(key("f", { ctrlKey: true, shiftKey: true }), context),
    undefined,
  );
});
test("single-key preference and long-press protection keep scrolling available", () => {
  for (const k of ["b", "g", "?", "+", "0"])
    assert.equal(
      readingShortcut(key(k), { ...context, singleKeys: false }),
      undefined,
    );
  assert.equal(
    readingShortcut(key("ArrowRight"), { ...context, singleKeys: false }),
    "next",
  );
  assert.equal(
    readingShortcut(key("ArrowDown", { repeat: true }), context),
    "down",
  );
  for (const k of ["ArrowRight", "b", "?", "+"])
    assert.equal(readingShortcut(key(k, { repeat: true }), context), undefined);
  assert.equal(
    readingShortcut(key("PageDown", { repeat: true }), context, true),
    "next",
  );
  assert.equal(readingShortcut(key("End", { ctrlKey: true }), context), "last");
  assert.equal(
    readingShortcut(key("Home", { metaKey: true }), context),
    "first",
  );
});

test("Ctrl wheel zoom normalizes units, direction and limits", () => {
  assert.ok(wheelZoom(1, -100, 0, 700) > 1);
  assert.ok(wheelZoom(1, 100, 0, 700) < 1);
  assert.equal(wheelZoom(1, -4, 1, 700), wheelZoom(1, -64, 0, 700));
  assert.equal(wheelZoom(1, 1, 2, 700), wheelZoom(1, 700, 0, 700));
  assert.equal(wheelZoom(4, -120, 0, 700), 4);
  assert.equal(wheelZoom(0.1, 120, 0, 700), 0.1);
  assert.equal(wheelZoom(1.5, 0, 0, 700), 1.5);
});
