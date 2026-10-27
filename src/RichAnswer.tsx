import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { answerMarkdown } from "../shared/markdown.ts";
import type { Source, Rect } from "../shared/types.ts";
import { Citation } from "./chat/Citation.tsx";
export function RichAnswer({
  text,
  sources = new Map(),
  navigate,
}: {
  text: string;
  sources?: Map<string, Source>;
  navigate: (page: number, documentId?: string, rect?: Rect, rects?: Rect[]) => void;
}) {
  const safe = (url: string) => (/^https?:\/\//i.test(url) ? url : "");
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      urlTransform={(url) => (url.startsWith("source:") ? url : safe(url))}
      components={{
        a: ({ href, children }) => {
          const source = href?.startsWith("source:")
            ? sources.get(href.slice(7))
            : undefined;
          return source ? (
            <Citation source={source} navigate={navigate}>
              {children}
            </Citation>
          ) : href && safe(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children} ↗
            </a>
          ) : (
            <span>{children}</span>
          );
        },
        img: () => null,
      }}
    >
      {answerMarkdown(text)}
    </Markdown>
  );
}
