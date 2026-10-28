import { manualEntries, parseManual } from "../shared/manual.ts";

const documents = import.meta.glob<string>("../docs/manual/*.md", { query: "?raw", import: "default", eager: true });
export const manualArticles = manualEntries.map(entry => parseManual(entry, documents[`../docs/manual/${entry.id}.md`]));
export const manualGroups = [...new Set(manualEntries.map(entry => entry.group))];
