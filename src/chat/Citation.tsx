import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Source, Rect } from "../../shared/types.ts";
import { renderUrl } from "../api.ts";
export function Citation({
  source,
  children,
  navigate,
}: {
  source: Source;
  children?: ReactNode;
  navigate: (n: number, documentId?: string, rect?: Rect, rects?: Rect[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLButtonElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e.type === "keydown" &&
        document.querySelector('[aria-modal="true"],.pointer-menu')
      )
        return;
      if (
        e.type === "keydown" &&
        ((e as KeyboardEvent).isComposing || e.defaultPrevented)
      )
        return;
      if (e.type !== "keydown" || (e as KeyboardEvent).key === "Escape") {
        if (e.type === "keydown") {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        setOpen(false);
      }
    };
    window.addEventListener("resize", close);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", close, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - 316, rect.left)),
      top: Math.max(8, Math.min(window.innerHeight - 330, rect.bottom + 6)),
    });
  }, [open]);
  return (
    <>
      <button
        ref={ref}
        className="citation-v2"
        aria-label={`查看第 ${source.page} 页来源`}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          if (matchMedia("(pointer: coarse)").matches) show();
          else {
            setOpen(false);
            if (!source.deleted)
              navigate(source.page, source.documentId, source.rect, source.rects);
            else show();
          }
        }}
      >
        {source.deleted
          ? "来源已删除"
          : children ||
            `${source.documentName ? source.documentName + " · " : ""}第 ${source.page} 页`}
      </button>
      {open &&
        createPortal(
          <div
            className="citation-preview"
            role="region"
            aria-label={`第 ${source.page} 页来源预览`}
            style={position}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
          >
            <div className="citation-preview-head">
              <strong>
                {source.documentName} · 第 {source.page} 页
                {source.deleted ? " · 来源已删除" : ""}
              </strong>
              <button aria-label="关闭来源预览" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            {!source.deleted && (
              <img
                src={renderUrl(
                  source.documentId,
                  source.page,
                  0,
                  undefined,
                  true,
                )}
                alt={`第 ${source.page} 页缩略图`}
              />
            )}
            <div className="source-excerpt-label">来源上下文</div>
            <p>{source.text || "本页没有可检索文字，请查看页面图像。"}</p>
            <button
              className="source-open"
              disabled={source.deleted}
              onClick={() => {
                setOpen(false);
                navigate(source.page, source.documentId, source.rect, source.rects);
              }}
            >
              {source.deleted ? "原始来源已删除" : "在课件中查看"}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
