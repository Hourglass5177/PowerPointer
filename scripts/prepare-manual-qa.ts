import path from "node:path";
import { Store } from "../server/store.ts";
import { ArtifactStore } from "../server/ai-artifacts.ts";
import type { Course } from "../shared/types.ts";

// Run only after importing the built-in sample in the isolated manual QA service.
const directory = path.resolve("output/manual/qa-data");
const store = new Store(directory);
try {
  const course = store.all<Course>("course").find(c => c.demo && c.documentIds.length);
  if (!course) throw Error("请先在手册检查服务中打开示例课件");
  const documentId = course.documentIds[0];
  new ArtifactStore(store, () => {}).create({
    id: "manual-ui-artifact", runId: "manual-ui-fixture", courseId: course.id, documentId,
    kind: "outline", title: "手册界面检查用成果", text: "仅用于检查编辑草稿的保留，不是模型生成结果。", sources: [],
  });
  if (!store.get("conversation", "manual-ui-history")) store.put("conversation", {
    id: "manual-ui-history", courseId: course.id, documentId, title: "手册界面检查会话", createdAt: new Date().toISOString(),
  });
  console.log("已准备独立的会话与成果编辑检查数据。");
} finally { store.close(); }
