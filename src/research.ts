import type { SelectionRef } from "../shared/types.ts";
export interface ResearchRequest { selection?: SelectionRef; reviewTurnId?: string; goal?: string; mode?: "research" | "compare" | "review" }
export function requestResearch(detail: ResearchRequest) { window.dispatchEvent(new CustomEvent("pointer:research", { detail })); }
