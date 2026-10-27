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
