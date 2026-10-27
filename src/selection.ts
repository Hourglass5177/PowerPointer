import type { SelectionRef } from "../shared/types.ts";
export type PointerRequest = {
  selection: SelectionRef;
  parentId?: string;
  position: { x: number; y: number };
  imageOnly?: boolean;
};
export function selectedOrBlock(event: React.MouseEvent, root: HTMLElement) {
  const selected = window.getSelection();
  if (
    selected?.toString().trim() &&
    selected.anchorNode &&
    selected.focusNode &&
    root.contains(selected.anchorNode) &&
    root.contains(selected.focusNode)
  )
    return selected.toString().slice(0, 12000);
  const target = event.target as HTMLElement;
  const block = target.closest(
    "p,li,td,th,h1,h2,h3,h4,pre,blockquote,.textLayer span",
  );
  if (!block || !root.contains(block)) return "";
  const text = block.textContent?.trim() || "";
  if (text) {
    const range = document.createRange();
    range.selectNodeContents(block);
    selected?.removeAllRanges();
    selected?.addRange(range);
  }
  return text.slice(0, 12000);
}
export function requestPointer(detail: PointerRequest) {
  window.dispatchEvent(new CustomEvent("pointer:request", { detail }));
}
