import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { Document, Rect, LearningNote } from "../shared/types.ts";
import { normalizedRect } from "../shared/geometry.ts";
import { requestPointer, selectedOrBlock } from "./selection.ts";
import { WheelPager, wheelZoom } from "./readingInteractions.ts";
pdfjs.GlobalWorkerOptions.workerSrc = worker;
type Props = {
  doc: Document;
  boxMode: boolean;
  selection?: Rect;
  selections?: Rect[];
  notes?: LearningNote[];
  onNote?: (id: string) => void;
  onSelect: (
    text: string,
    rect?: Rect,
    anchor?: { x: number; y: number },
    rects?: Rect[],
  ) => void;
  onError: (message: string) => void;
  onScale?: (scale: number) => void;
  interactionEnabled?: boolean;
  wheelEnabled?: boolean;
  onPageStep?: (direction: -1 | 1) => void;
  onZoom?: (scale: number) => void;
  pageArrival?: { documentId: string; page: number; edge: "top" | "bottom" };
};
export function PdfReader({
  doc,
  boxMode,
  selection,
  selections,
  notes = [],
  onNote,
  onSelect,
  onError,
  onScale,
  interactionEnabled = true,
  wheelEnabled = true,
  onPageStep,
  onZoom,
  pageArrival,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null),
    [width, setWidth] = useState(800),
    [height, setHeight] = useState(600),
    [viewport, setViewport] = useState<pdfjs.PageViewport | null>(null),
    [busy, setBusy] = useState(true),
    [draft, setDraft] = useState<Rect>();
  const start = useRef<number[] | null>(null);
  const pager = useRef(new WheelPager());
  const renderedScale = useRef(1);
  const zoomFrame = useRef(0);
  const wheelTarget = useRef({ scale: 1, time: -Infinity });
  const zoomAnchor = useRef<
    | { x: number; y: number; clientX: number; clientY: number; scale: number }
    | undefined
  >(undefined);
  const shownPage = useRef("");
  const arrival = useRef(pageArrival);
  arrival.current = pageArrival;
  const live = useRef({
    doc,
    busy,
    interactionEnabled,
    wheelEnabled,
    onPageStep,
    onZoom,
  });
  live.current = {
    doc,
    busy,
    interactionEnabled,
    wheelEnabled,
    onPageStep,
    onZoom,
  };
  useEffect(() => {
    pager.current.reset();
    wheelTarget.current.time = -Infinity;
    zoomAnchor.current = undefined;
    cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = 0;
  }, [doc.id, interactionEnabled, wheelEnabled]);
  useEffect(() => {
    wheelTarget.current.time = -Infinity;
    zoomAnchor.current = undefined;
    cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = 0;
  }, [doc.page, doc.rotation]);
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current,
      el = host.current,
      paper = surface.current;
    if (
      !anchor ||
      !el ||
      !paper ||
      !viewport ||
      Math.abs(viewport.scale - anchor.scale) > 0.001
    )
      return;
    const bounds = paper.getBoundingClientRect(),
      hostBounds = el.getBoundingClientRect();
    el.scrollLeft +=
      bounds.left -
      hostBounds.left +
      anchor.x * viewport.width -
      anchor.clientX;
    el.scrollTop +=
      bounds.top - hostBounds.top + anchor.y * viewport.height - anchor.clientY;
    zoomAnchor.current = undefined;
  }, [viewport]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      const current = live.current;
      const direction = pager.current.feed({
        time: performance.now(),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        height: el.clientHeight,
        top: el.scrollTop,
        maxTop: Math.max(0, el.scrollHeight - el.clientHeight),
        page: current.doc.page,
        pages: current.doc.pages,
        blocked:
          !current.interactionEnabled ||
          !current.wheelEnabled ||
          current.busy ||
          !!start.current ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          event.defaultPrevented ||
          !!document.querySelector('[aria-modal="true"],.pointer-menu'),
      });
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        current.interactionEnabled &&
        current.onZoom &&
        !event.defaultPrevented &&
        !document.querySelector('[aria-modal="true"],.pointer-menu')
      ) {
        // Consume browser zoom only over the PDF. Ctrl-wheel never turns a page.
        event.preventDefault();
        if (
          start.current ||
          !event.deltaY ||
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
        )
          return;
        const now = performance.now();
        const scale =
          now - wheelTarget.current.time < 180
            ? wheelTarget.current.scale
            : current.doc.fitMode === "custom"
              ? current.doc.zoom || 1
              : renderedScale.current;
        const next = wheelZoom(
          scale,
          event.deltaY,
          event.deltaMode,
          el.clientHeight,
        );
        wheelTarget.current = { scale: next, time: now };
        const bounds = surface.current?.getBoundingClientRect(),
          hostBounds = el.getBoundingClientRect();
        if (bounds)
          zoomAnchor.current = {
            x: (event.clientX - bounds.left) / bounds.width,
            y: (event.clientY - bounds.top) / bounds.height,
            clientX: event.clientX - hostBounds.left,
            clientY: event.clientY - hostBounds.top,
            scale: next,
          };
        if (!zoomFrame.current)
          zoomFrame.current = requestAnimationFrame(() => {
            zoomFrame.current = 0;
            const latest = live.current;
            if (
              latest.doc.fitMode !== "custom" ||
              latest.doc.zoom !== wheelTarget.current.scale
            )
              latest.onZoom?.(wheelTarget.current.scale);
          });
        return;
      }
      if (direction) {
        event.preventDefault();
        current.onPageStep?.(direction);
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      cancelAnimationFrame(zoomFrame.current);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    setPdf(null);
    setBusy(true);
    const task = pdfjs.getDocument({
      url: `/api/documents/${doc.id}/pdf`,
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
      enableXfa: false,
    });
    task.promise
      .then((p) => {
        if (!stopped) setPdf(p);
      })
      .catch((e) => {
        if (!stopped) {
          onError(String(e));
          setBusy(false);
        }
      });
    return () => {
      stopped = true;
      void task.destroy();
    };
  }, [doc.id]);
  useEffect(() => {
    const observer = new ResizeObserver((e) => {
      if (!e[0].contentRect.width || !e[0].contentRect.height) return;
      setWidth(e[0].contentRect.width);
      setHeight(e[0].contentRect.height);
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current || !text.current) return;
    let cancelled = false,
      renderTask: pdfjs.RenderTask | undefined,
      layer: pdfjs.TextLayer | undefined;
    setBusy(true);
    live.current.busy = true;
    setDraft(undefined);
    text.current.replaceChildren();
    void (async () => {
      try {
        const page = await pdf.getPage(doc.page);
        if (cancelled) return;
        const rotation = (page.rotate + doc.rotation) % 360;
        const base = page.getViewport({ scale: 1, rotation });
        const mode = doc.fitMode || (doc.zoom ? "custom" : "width");
        const scale =
          mode === "custom"
            ? doc.zoom || 1
            : Math.max(
                0.1,
                Math.min(
                  (width - 48) / base.width,
                  mode === "page" ? (height - 48) / base.height : Infinity,
                ),
              );
        onScale?.(scale);
        renderedScale.current = scale;
        const vp = page.getViewport({ scale, rotation });
        setViewport(vp);
        const c = canvas.current!;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.ceil(vp.width * dpr);
        c.height = Math.ceil(vp.height * dpr);
        c.style.width = `${vp.width}px`;
        c.style.height = `${vp.height}px`;
        renderTask = page.render({
          canvas: c,
          viewport: vp,
          transform: [dpr, 0, 0, dpr, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        const div = text.current!;
        div.style.setProperty("--scale-factor", String(scale));
        div.style.setProperty("--total-scale-factor", String(scale));
        div.style.setProperty("--user-unit", String(page.userUnit));
        layer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: div,
          viewport: vp,
        });
        await layer.render();
        if (!cancelled) {
          const key = `${doc.id}:${doc.page}`;
          if (shownPage.current !== key && host.current) {
            const target = arrival.current;
            host.current.scrollTop =
              target?.documentId === doc.id &&
              target.page === doc.page &&
              target.edge === "bottom"
                ? host.current.scrollHeight
                : 0;
            host.current.scrollLeft = 0;
            shownPage.current = key;
          }
          setBusy(false);
        }
      } catch (e: any) {
        if (!cancelled && e.name !== "RenderingCancelledException") {
          onError(e.message);
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      layer?.cancel();
    };
  }, [pdf, doc.page, doc.rotation, doc.zoom, doc.fitMode, width, height]);
  useEffect(() => {
    start.current = null;
    setDraft(undefined);
  }, [boxMode, doc.id, doc.page, doc.rotation]);
  const point = (e: React.PointerEvent) => {
    const r = surface.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const overlay =
    draft ||
    (selection && viewport
      ? normalizedRect(
          viewport.convertToViewportPoint(selection[0], selection[1]),
          viewport.convertToViewportPoint(selection[2], selection[3]),
        )
      : undefined);
  const selectionGeometry = () => {
    const selected = window.getSelection(), paper = surface.current;
    if (!selected?.rangeCount || !paper || !viewport || !selected.anchorNode || !selected.focusNode || !paper.contains(selected.anchorNode) || !paper.contains(selected.focusNode)) return {};
    const bounds = paper.getBoundingClientRect();
    const rects: Rect[] = [];
    for (const rect of selected.getRangeAt(0).getClientRects()) {
      const left = Math.max(0, Math.min(viewport.width, (rect.left - bounds.left) * viewport.width / bounds.width));
      const top = Math.max(0, Math.min(viewport.height, (rect.top - bounds.top) * viewport.height / bounds.height));
      const right = Math.max(left, Math.min(viewport.width, (rect.right - bounds.left) * viewport.width / bounds.width));
      const bottom = Math.max(top, Math.min(viewport.height, (rect.bottom - bounds.top) * viewport.height / bounds.height));
      if (right - left < 1 || bottom - top < 1) continue;
      const pdfRect = normalizedRect(viewport.convertToPdfPoint(left, top), viewport.convertToPdfPoint(right, bottom));
      if (!rects.some(r => r.every((v, i) => Math.abs(v - pdfRect[i]) < .5))) rects.push(pdfRect);
    }
    const limited = rects.slice(0, 300);
    return { rects: limited, rect: limited.length ? [Math.min(...limited.map(r => r[0])), Math.min(...limited.map(r => r[1])), Math.max(...limited.map(r => r[2])), Math.max(...limited.map(r => r[3]))] as Rect : undefined };
  };
  return (
    <div
      className="page-scroll"
      ref={host}
      data-testid="page-scroll"
      aria-busy={busy}
    >
      <div className="page-centering">
        <div
          ref={surface}
          className={`pdf-page ${boxMode ? "box-mode" : ""}`}
          style={{
            width: viewport?.width || 400,
            height: viewport?.height || 300,
          }}
          data-testid="pdf-page"
          onContextMenu={(e) => {
            if (busy) return;
            const selected = selectedOrBlock(e, e.currentTarget);
            e.preventDefault();
            requestPointer({
              selection: {
                id: crypto.randomUUID(),
                kind: "text",
                documentId: doc.id,
                documentName: doc.name,
                page: doc.page,
                rotation: doc.rotation,
                text: selected,
                ...selectionGeometry(),
              },
              position: { x: e.clientX, y: e.clientY },
              imageOnly: !selected,
            });
          }}
          onPointerDown={(e) => {
            if (!boxMode || busy || e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = point(e);
            setDraft(undefined);
          }}
          onPointerMove={(e) => {
            if (boxMode && start.current)
              setDraft(normalizedRect(start.current, point(e)));
          }}
          onPointerCancel={() => {
            start.current = null;
            setDraft(undefined);
          }}
          onPointerUp={(e) => {
            if (boxMode && start.current && viewport) {
              const end = point(e),
                a = start.current;
              start.current = null;
              setDraft(undefined);
              if (Math.abs(end[0] - a[0]) > 5 && Math.abs(end[1] - a[1]) > 5)
                onSelect(
                  "",
                  normalizedRect(
                    viewport.convertToPdfPoint(...(a as [number, number])),
                    viewport.convertToPdfPoint(...(end as [number, number])),
                  ),
                  { x: e.clientX, y: e.clientY },
                );
            } else if (!boxMode && e.button === 0 && !(e.target as HTMLElement).closest(".page-note-marker")) {
              const s = window.getSelection();
              if (
                s?.toString().trim() &&
                s.anchorNode &&
                surface.current?.contains(s.anchorNode)
              )
                { const geometry = selectionGeometry(); onSelect(s.toString().slice(0, 12000), geometry.rect, { x: e.clientX, y: e.clientY + 12 }, geometry.rects); }
            }
          }}
        >
          <canvas ref={canvas} aria-label={`课件第 ${doc.page} 页`} />
          <div className="textLayer" ref={text} />
          {selections?.map((rect, i) => {
            if (!viewport) return null;
            const area = normalizedRect(viewport.convertToViewportPoint(rect[0], rect[1]), viewport.convertToViewportPoint(rect[2], rect[3]));
            return <div key={i} className="note-highlight" style={{ left: area[0], top: area[1], width: area[2] - area[0], height: area[3] - area[1] }} />;
          })}
          {notes.filter(n => n.anchor?.documentId === doc.id && n.anchor.page === doc.page && !n.deletedAt).map((note, i) => {
            const rect = note.anchor?.rects?.[0] || note.anchor?.rect;
            const area = rect && viewport ? normalizedRect(viewport.convertToViewportPoint(rect[0], rect[1]), viewport.convertToViewportPoint(rect[2], rect[3])) : undefined;
            return <button key={note.id} className="page-note-marker" title={note.title} aria-label={`打开笔记 ${note.title}`} style={{ top: Math.max(4, Math.min((viewport?.height || 300) - 24, area ? area[1] : 12 + i * 28)), right: -12 }} onClick={e => { e.stopPropagation(); onNote?.(note.id); }}>✎</button>;
          })}
          {overlay && !selections?.length && (
            <div
              className="selection-box"
              style={{
                left: overlay[0],
                top: overlay[1],
                width: overlay[2] - overlay[0],
                height: overlay[3] - overlay[1],
              }}
            >
              <span>选区</span>
            </div>
          )}
          {busy && <div className="rendering">正在呈现第 {doc.page} 页…</div>}
        </div>
      </div>
    </div>
  );
}
