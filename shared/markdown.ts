/** One-line readable text for note lists; hides markup and internal source links. */
export function plainPreview(text: string, limit = 100) {
  const plain = text
    .replace(/^[ \t]*(`{3,}|~{3,}).*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\$\$|\|/g, " ")
    .replace(/(?<=\s|^)\$([^$\n]+)\$/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：！？、）】])/g, "$1")
    .trim();
  return plain.length > limit ? plain.slice(0, limit) + "…" : plain;
}
/** Normalize model math delimiters and CJK emphasis without rewriting code. */
export function answerMarkdown(text: string) {
  const code =
    /(`{3,}[^\n]*\n[\s\S]*?(?:\n[ \t]*`{3,}|$)|~{3,}[^\n]*\n[\s\S]*?(?:\n[ \t]*~{3,}|$))/g;
  return text
    .split(code)
    .map((part, i) => {
      if (i % 2) return part;
      const inline: string[] = [];
      const restore = (value: string) =>
        value.replace(/\uE000(\d+)\uE001/g, (_m, n) => inline[Number(n)]);
      return restore(
        part
          .replace(/`+[^`\n]*`+/g, (value) => {
            inline.push(value);
            return `\uE000${inline.length - 1}\uE001`;
          })
          .replace(/\\\[([\s\S]*?)\\\]/g, (_m, c) => `\n$$\n${c}\n$$\n`)
          .replace(/\\\(([\s\S]*?)\\\)/g, (_m, c) => `$${c}$`)
          .replace(
            /\*\*([^*\n]+)\*\*/g,
            (match, content: string, offset: number, source: string) => {
              // CommonMark needs separation when punctuation borders Chinese words.
              const word = (s: string) =>
                !!s && !/[\s\p{P}\p{S}\uE000\uE001]/u.test(s);
              const punctuation = (s: string) => /[\p{P}\p{S}]/u.test(s);
              content = restore(content);
              const before =
                punctuation(content[0]) && word(source[offset - 1]);
              const after =
                punctuation(content.at(-1)!) &&
                word(source[offset + match.length]);
              return `${before ? " " : ""}${match}${after ? " " : ""}`;
            },
          ),
      );
    })
    .join("");
}
