import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { manualHref, readManualRoute, searchManual, type ManualRoute } from "../shared/manual.ts";
import { manualArticles, manualGroups } from "./manual-content.ts";
import { Icon } from "./controls.tsx";
import "./manual.css";

function ManualDialog({ title, className, children, onClose, returnFocus }: { title: string; className: string; children: ReactNode; onClose: () => void; returnFocus: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = returnFocus || document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      requestAnimationFrame(() => {
        const label = previous?.getAttribute("aria-label");
        const target = previous?.isConnected ? previous : label
          ? Array.from(document.querySelectorAll<HTMLElement>('.manual-page button[aria-label]')).find(button => button.getAttribute("aria-label") === label) : null;
        target?.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog className={`manual-dialog ${className}`} ref={dialog} aria-label={title} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="manual-dialog-heading"><strong>{title}</strong><button type="button" aria-label={`关闭${title}`} onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

const imageSizes: Record<string, [number, number]> = {
  "/manual/reading.jpg": [1440, 900],
  "/manual/selection.jpg": [570, 470],
  "/manual/scope.jpg": [390, 542],
  "/manual/notes.jpg": [390, 808],
  "/manual/overview.jpg": [1100, 620],
};

export default function ManualPage({ route, onClose }: { route: ManualRoute; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [photo, setPhoto] = useState<{ src: string; alt: string }>();
  const dialogOpener = useRef<HTMLElement | null>(null);
  const markdownComponents = useMemo<Components>(() => ({
    a: ({ href, children }) => href ? <a href={href} {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a> : <span>{children}</span>,
    img: ({ src, alt }) => typeof src === "string" && imageSizes[src] ? <span className="manual-figure"><button type="button" aria-label={`放大图片：${alt}`} onClick={event => { dialogOpener.current = event.currentTarget; setPhoto({ src, alt: alt || "界面示例" }); }}><img src={src} alt={alt || "界面示例"} width={imageSizes[src][0]} height={imageSizes[src][1]} /><span className="manual-figure-zoom"><Icon name="expand" size={15} />放大</span></button><span className="manual-caption">{alt}</span></span> : null,
    table: ({ children }) => <div className="manual-table-scroll" role="region" aria-label="操作对照表" tabIndex={0}><table>{children}</table></div>,
  }), []);
  const [activeSection, setActiveSection] = useState("");
  const scroll = useRef<HTMLDivElement>(null), content = useRef<HTMLElement>(null), search = useRef<HTMLInputElement>(null);
  const originalTitle = useRef(document.title);
  const article = manualArticles.find(a => a.id === route.articleId);
  const articleIndex = article ? manualArticles.indexOf(article) : -1;
  const searching = !!query.trim();
  const results = useMemo(() => searchManual(manualArticles, query), [query]);
  const missing = route.invalid || route.articleId && !article;
  const missingSection = !!(route.sectionId && article && !article.sections.some(s => s.id === route.sectionId));
  const routeKey = `${route.articleId || ""}/${route.sectionId || ""}/${!!route.invalid}`;

  const focusContent = () => {
    const target = route.sectionId && !missingSection
      ? content.current?.querySelector<HTMLElement>(`#manual-section-${route.sectionId}`)
      : content.current?.querySelector<HTMLElement>("h1");
    if (document.activeElement !== search.current) target?.focus({ preventScroll: true });
    if (route.sectionId && !missingSection) target?.scrollIntoView({ block: "start" });
    else scroll.current?.scrollTo({ top: 0 });
  };
  useLayoutEffect(() => {
    setQuery(""); setDrawer(false); setPhoto(undefined);
    const frame = requestAnimationFrame(focusContent);
    return () => cancelAnimationFrame(frame);
  }, [routeKey]);
  useLayoutEffect(() => {
    if (searching) scroll.current?.scrollTo({ top: 0 });
    else { const frame = requestAnimationFrame(focusContent); return () => cancelAnimationFrame(frame); }
  }, [searching]);
  useEffect(() => {
    document.title = `${article?.title || "使用手册"} · Power Pointer`;
  }, [article]);
  useEffect(() => () => { document.title = originalTitle.current; }, []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape" || photo || drawer) return;
      if (searching) { setQuery(""); search.current?.focus(); }
      else onClose();
      event.preventDefault();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onClose, photo, drawer, searching]);

  const followLink = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = (event.target as HTMLElement).closest("a")?.getAttribute("href");
    if (!href || !readManualRoute(href)) return;
    setQuery(""); setDrawer(false);
    if (window.location.hash === href) requestAnimationFrame(focusContent);
  };
  const trackSection = () => {
    if (!article || searching || !scroll.current) return;
    const top = scroll.current.getBoundingClientRect().top + 90;
    const headings = Array.from(content.current?.querySelectorAll<HTMLElement>("h2[id]") || []);
    setActiveSection(headings.filter(h => h.getBoundingClientRect().top <= top).at(-1)?.id.replace("manual-section-", "") || "");
  };
  const navigation = <nav aria-label="手册章节">
    <a className="manual-home-link" href={manualHref()} aria-current={!route.articleId && !searching ? "page" : undefined}><Icon name="file" size={16} />手册首页</a>
    {manualGroups.map(group => <div className="manual-nav-group" key={group}><h2>{group}</h2>{manualArticles.filter(a => a.group === group).map(a =>
      <a key={a.id} href={manualHref(a.id)} aria-current={a.id === article?.id && !searching ? "page" : undefined}>{a.title}</a>)}</div>)}
  </nav>;
  const toc = article && <nav aria-label="本页目录"><span className="manual-toc-label">本页内容</span>{article.sections.map(s =>
    <a key={s.id} href={manualHref(article.id, s.id)} aria-current={activeSection === s.id ? "location" : undefined}>{s.title}</a>)}</nav>;

  return <div className="manual-page" onClick={followLink}>
    <a className="manual-skip" href="#manual-main" onClick={event => { event.preventDefault(); content.current?.focus(); }}>跳到正文</a>
    <header className="manual-header">
      <div className="manual-header-brand"><button className="manual-return" onClick={onClose}><Icon name="left" size={17} /><span>返回工作区</span></button><span className="manual-brand">Power Pointer <span>/ 使用手册</span></span></div>
      <label className="manual-search"><Icon name="search" size={18} /><input ref={search} aria-label="搜索使用手册" placeholder="搜索问题、功能或操作…" value={query} onChange={event => setQuery(event.target.value)} maxLength={160} />{query && <button type="button" aria-label="清除手册搜索" onClick={() => { setQuery(""); search.current?.focus(); }}><Icon name="close" size={16} /></button>}</label>
      <button className="manual-menu-toggle" aria-label="打开手册目录" aria-haspopup="dialog" aria-expanded={drawer} onClick={event => { dialogOpener.current = event.currentTarget; setDrawer(true); }}><Icon name="menu" size={19} /><span>目录</span></button>
    </header>
    <div className="manual-layout">
      <aside className="manual-sidebar">{navigation}<p>按步骤学习，或随时查阅。</p></aside>
      <div className="manual-scroll" ref={scroll} onScroll={trackSection}>
        <div className={`manual-content-layout ${!article || searching ? "manual-content-wide" : ""}`}>
          <main className="manual-main" id="manual-main" tabIndex={-1} ref={content}>
            {searching ? <>
              <div className="manual-breadcrumb"><a href={manualHref()}>使用手册</a><span>/</span><span>搜索</span></div>
              <h1 tabIndex={-1}>搜索结果</h1><p className="manual-lead" role="status">{results.length ? `找到 ${results.length} 篇相关内容` : "没有找到相关内容"}</p>
              {results.length ? <div className="manual-results">{results.map(hit => <a className="manual-result" href={manualHref(hit.article.id, hit.section?.id)} key={hit.article.id}><span className="manual-result-path">{hit.article.group} / {hit.article.title}</span><h2>{hit.section?.title || hit.article.title}<Icon name="right" size={17} /></h2><p>{hit.excerpt}</p></a>)}</div> : <div className="manual-search-empty"><p>试试更短的词，例如“笔记”“PPT”或“连接”。也可以从左侧目录查找。</p><button onClick={() => setQuery("")}>返回浏览</button></div>}
            </> : missing ? <><h1 tabIndex={-1}>没有找到这篇内容</h1><p className="manual-lead">链接可能已变更。请从目录选择，或搜索相关操作。</p><a className="manual-text-link" href={manualHref()}>返回手册首页 →</a></> : article ? <>
              <div className="manual-breadcrumb"><a href={manualHref()}>使用手册</a><span>/</span><span>{article.group}</span></div>
              <h1 tabIndex={-1}>{article.title}</h1><p className="manual-lead">{article.summary}</p>
              {missingSection && <p className="manual-notice" role="status">该小节链接已失效，以下是本章完整内容。</p>}
              <details className="manual-inline-toc"><summary>本页内容</summary>{toc}</details>
              <article className="manual-prose">{article.sections.map(section => <section key={section.id} aria-labelledby={`manual-section-${section.id}`}>
                <h2 id={`manual-section-${section.id}`} tabIndex={-1}><a href={manualHref(article.id, section.id)}>{section.title}<span className="manual-anchor" aria-hidden="true">#</span></a></h2>
                <Markdown remarkPlugins={[remarkGfm]} skipHtml
                  urlTransform={url => readManualRoute(url) || /^\/manual\/[a-z0-9-]+\.jpg$/.test(url) || /^https?:\/\//i.test(url) ? url : ""}
                  components={markdownComponents}>{section.markdown}</Markdown>
              </section>)}</article>
              <nav className="manual-pagination" aria-label="相邻章节">{articleIndex > 0 ? <a href={manualHref(manualArticles[articleIndex - 1].id)}><small>上一章</small><span>← {manualArticles[articleIndex - 1].title}</span></a> : <span />}{articleIndex < manualArticles.length - 1 && <a href={manualHref(manualArticles[articleIndex + 1].id)}><small>下一章</small><span>{manualArticles[articleIndex + 1].title} →</span></a>}</nav>
            </> : <>
              <div className="manual-breadcrumb">Power Pointer / 使用手册</div>
              <h1 className="manual-home-title" tabIndex={-1}>使用手册</h1>
              <p className="manual-lead">从打开课件到整理学习成果，按步骤开始，或查找需要的操作。</p>
              <a className="manual-start" href={manualHref("start")}><span className="manual-start-icon"><Icon name="steps" size={27} /></span><span><small>首次使用</small><strong>快速上手</strong><span>打开课件 → 理解难点 → 保存笔记</span></span><Icon name="right" size={22} /></a>
              <div className="manual-topic-groups">{manualGroups.map(group => <section key={group}><h2>{group}</h2>{manualArticles.filter(a => a.group === group && a.id !== "start").map(a => <a href={manualHref(a.id)} key={a.id}><span><strong>{a.title}</strong><small>{a.sections.slice(0, 3).map(s => s.title).join(" · ")}</small></span><Icon name="right" size={16} /></a>)}</section>)}</div>
              <div className="manual-home-footer"><Icon name="info" size={17} /><span>阅读手册无需连接模型。<a href={manualHref("help")}>遇到问题？查看常见问题 →</a></span></div>
            </>}
          </main>
          {article && !searching && <aside className="manual-toc">{toc}</aside>}
        </div>
      </div>
    </div>
    {drawer && <ManualDialog title="手册目录" className="manual-drawer" returnFocus={dialogOpener.current} onClose={() => setDrawer(false)}>{navigation}</ManualDialog>}
    {photo && <ManualDialog title="查看示例图片" className="manual-photo" returnFocus={dialogOpener.current} onClose={() => setPhoto(undefined)}><div className="manual-photo-body"><img src={photo.src} alt={photo.alt} /></div><p>{photo.alt}</p></ManualDialog>}
  </div>;
}
