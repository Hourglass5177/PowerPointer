import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { manualHref, readManualRoute } from "../shared/manual.ts";

// Manual navigation deliberately does not change or persist the learning workspace.
export function useManual() {
  const [route, setRoute] = useState(() => readManualRoute(window.location.hash));
  const returnFocus = useRef<HTMLElement | null>(null);
  const previousHash = useRef("");
  const wasOpen = useRef(!!route);
  useEffect(() => {
    const sync = () => setRoute(readManualRoute(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useLayoutEffect(() => {
    if (wasOpen.current && !route) {
      requestAnimationFrame(() => {
        const target = returnFocus.current;
        const fallback = document.querySelector<HTMLElement>('.help-menu > summary');
        (target?.isConnected && target.getClientRects().length ? target : fallback)?.focus({ preventScroll: true });
      });
    }
    wasOpen.current = !!route;
  }, [route]);
  return {
    route,
    open(articleId?: string, origin?: HTMLElement) {
      if (!route) {
        const active = origin || document.activeElement as HTMLElement;
        returnFocus.current = active.closest('.help-menu')?.querySelector<HTMLElement>('summary') || active;
        previousHash.current = window.location.hash;
      }
      window.location.hash = manualHref(articleId);
    },
    close() { window.location.hash = previousHash.current; },
  };
}
