export const chatFontSizes = [
  { id: "small", label: "小", px: 14 },
  { id: "standard", label: "标准", px: 16 },
  { id: "large", label: "大", px: 18 },
  { id: "xlarge", label: "特大", px: 20 },
] as const;
export type ChatFont = (typeof chatFontSizes)[number]["id"];
type FontStorage = Pick<Storage, "getItem" | "setItem">;
const key = "pointer-chat-font";

export function readChatFont(storage: FontStorage = localStorage): ChatFont {
  try {
    const saved = storage.getItem(key);
    return chatFontSizes.find((s) => s.id === saved)?.id ?? "standard";
  } catch {
    return "standard";
  }
}
export function saveChatFont(font: ChatFont, storage: FontStorage = localStorage) {
  try {
    storage.setItem(key, font);
  } catch {
    // The chosen size still applies until the page reloads.
  }
}
export function applyChatFont(
  font: ChatFont,
  root: { style: Pick<CSSStyleDeclaration, "setProperty"> } = document.documentElement,
) {
  const px = chatFontSizes.find((s) => s.id === font)?.px ?? 16;
  root.style.setProperty("--chat-font-size", `${px}px`);
}
