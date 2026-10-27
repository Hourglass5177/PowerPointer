import { useEffect, useRef } from "react";
import type { Reader } from "./useReader.ts";
import { renderUrl } from "./api.ts";
import { Tool } from "./controls.tsx";
export function Navigation({ r }: { r: Reader }) {
  const current = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [r.doc?.page]);
  useEffect(() => {
    if (r.searchOpen) search.current?.focus();
  }, [r.searchOpen]);
  if (!r.doc) return null;
  return (
    <aside
      className={`navigation ${r.searchOpen ? "searching" : ""}`}
      aria-label="页面导航"
    >
      <div className="pane-heading">
        <strong>{r.searchOpen ? "搜索" : "幻灯片"}</strong>
        <Tool
          icon="close"
          title="关闭导航"
          onClick={() => {
            r.setRail(false);
            r.setSearchOpen(false);
          }}
        />
      </div>
      {r.searchOpen ? (
        <div className="search-content">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void r.runSearch();
            }}
          >
            <input
              ref={search}
              aria-label="全文搜索"
              placeholder="搜索课件"
              value={r.searchText}
              onChange={(e) => r.setSearchText(e.target.value)}
            />
            <button aria-label="搜索" type="submit">
              ↵
            </button>
          </form>
          {r.doc.indexedPages === 0 && r.doc.indexStatus === "ready" ? (
            <p className="empty-note">
              此课件没有可检索的文字。可框选页面提问。
            </p>
          ) : !r.searched ? (
            <p className="empty-note">输入关键词查找页面</p>
          ) : !r.results.length ? (
            <p className="empty-note">未找到相关内容</p>
          ) : (
            r.results.map((result) => (
              <div className="search-result" key={result.page}>
                <button onClick={() => r.go(result.page)}>
                  <b>第 {result.page} 页</b>
                  <p>{result.text.slice(0, 170)}</p>
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={r.extraPages.includes(result.page)}
                    disabled={
                      !r.extraPages.includes(result.page) &&
                      r.extraPages.length >= 2
                    }
                    onChange={(e) =>
                      r.setExtraPages((p) =>
                        e.target.checked
                          ? [...p, result.page]
                          : p.filter((n) => n !== result.page),
                      )
                    }
                  />
                  附加此页图像
                </label>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="thumbnails" aria-label="缩略图导航">
          {Array.from({ length: r.doc.pages }, (_, i) => i + 1).map((n) => (
            <button
              ref={n === r.doc!.page ? current : undefined}
              key={n}
              aria-label={`跳到第 ${n} 页`}
              aria-current={n === r.doc!.page ? "page" : undefined}
              className={n === r.doc!.page ? "active" : ""}
              onClick={() => r.go(n)}
            >
              <span>{n}</span>
              <img
                src={renderUrl(r.doc!.id, n, 0, undefined, true)}
                loading="lazy"
                alt=""
              />
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
