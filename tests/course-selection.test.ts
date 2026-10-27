import test from "node:test";
import assert from "node:assert/strict";
import { readingDocumentId } from "../src/courseSelection.ts";
import type { Course, Document } from "../shared/types.ts";

const docs = [{ id: "fp" }, { id: "theory" }] as Document[];
test("切换课程时不显示上一门课，空课程与等待导入不会退回独立课件", () => {
  const course = { id: "c", documentIds: ["theory"] } as Course;
  assert.equal(readingDocumentId(docs, "c", course, "fp"), "theory");
  assert.equal(readingDocumentId(docs, "c", { ...course, documentIds: [] }, "fp"), "");
  assert.equal(readingDocumentId([docs[0]], "c", course, "fp"), "");
  assert.equal(readingDocumentId(docs, "c", course, ""), "theory");
  assert.equal(readingDocumentId(docs, "", undefined, "fp"), "fp");
});
