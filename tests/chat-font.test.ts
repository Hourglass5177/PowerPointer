import test from "node:test";
import assert from "node:assert/strict";
import { applyChatFont, chatFontSizes, readChatFont, saveChatFont } from "../src/chatFont.ts";

const storage = (value?: string) => {
  const items = new Map(value === undefined ? [] : [["pointer-chat-font", value]]);
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, next: string) => void items.set(key, next) };
};

test("问答字号默认标准，保存后恢复，无效值或存储不可用时回到默认", () => {
  assert.equal(chatFontSizes.find(s => s.id === "standard")?.px, 16);
  assert.equal(readChatFont(storage()), "standard");
  assert.equal(readChatFont(storage("huge")), "standard");
  assert.equal(readChatFont(storage("constructor")), "standard");
  const saved = storage();
  saveChatFont("large", saved);
  assert.equal(readChatFont(saved), "large");
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.equal(readChatFont(blocked), "standard");
  assert.doesNotThrow(() => saveChatFont("small", blocked));
});

test("问答字号写入根元素变量，供问答区和解释窗共用", () => {
  const values = new Map<string, string>();
  const root = { style: { setProperty: (name: string, value: string) => void values.set(name, value) } };
  applyChatFont("xlarge", root);
  assert.equal(values.get("--chat-font-size"), "20px");
  applyChatFont("standard", root);
  assert.equal(values.get("--chat-font-size"), "16px");
});
