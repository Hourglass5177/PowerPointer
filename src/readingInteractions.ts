export const WHEEL_IDLE_MS = 180;
export const WHEEL_THRESHOLD = 60;
export const WHEEL_LOCK_MS = 300;

export function wheelZoom(
  scale: number,
  delta: number,
  mode: number,
  height: number,
) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return Math.max(
    0.1,
    Math.min(
      4,
      Math.round(
        scale * Math.exp(-Math.max(-240, Math.min(240, pixels)) / 600) * 1000,
      ) / 1000,
    ),
  );
}

export type WheelSample = {
  time: number;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  height: number;
  top: number;
  maxTop: number;
  page: number;
  pages: number;
  blocked?: boolean;
};

/** One gesture may either scroll the page or turn it, never both. */
export class WheelPager {
  private last = -Infinity;
  private lockedUntil = -Infinity;
  private direction = 0;
  private eligible = false;
  private used = false;
  private amount = 0;

  reset() {
    this.last = this.lockedUntil = -Infinity;
    this.direction = this.amount = 0;
    this.eligible = this.used = false;
  }

  feed(s: WheelSample): -1 | 0 | 1 {
    const direction = Math.sign(s.deltaY);
    const fresh = s.time - this.last >= WHEEL_IDLE_MS;
    this.last = s.time;
    if (fresh) {
      this.used = false;
      this.amount = 0;
      this.direction = direction;
      this.eligible = direction < 0 ? s.top <= 2 : s.maxTop - s.top <= 2;
    }
    if (s.blocked || !direction || Math.abs(s.deltaX) >= Math.abs(s.deltaY)) {
      this.eligible = false;
      return 0;
    }
    // Reversing a gesture starts page scrolling; a new gesture can turn a page.
    if (direction !== this.direction) this.eligible = false;
    if (!this.eligible || this.used || s.time < this.lockedUntil) return 0;
    const unit = s.deltaMode === 1 ? 16 : s.deltaMode === 2 ? s.height : 1;
    this.amount += Math.abs(s.deltaY) * unit;
    if (this.amount < WHEEL_THRESHOLD) return 0;
    if ((direction < 0 && s.page <= 1) || (direction > 0 && s.page >= s.pages))
      return 0;
    this.used = true;
    this.lockedUntil = s.time + WHEEL_LOCK_MS;
    return direction as -1 | 1;
  }
}

export type ReadingAction =
  | "text"
  | "box"
  | "search"
  | "jump"
  | "previous"
  | "next"
  | "up"
  | "down"
  | "top"
  | "bottom"
  | "first"
  | "last"
  | "zoomIn"
  | "zoomOut"
  | "fitPage"
  | "fitWidth"
  | "help";
type KeyInput = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "isComposing"
  | "repeat"
  | "defaultPrevented"
>;
export function readingShortcut(
  e: KeyInput,
  context: {
    active: boolean;
    blocked: boolean;
    pageFocused: boolean;
    singleKeys: boolean;
  },
  includeRepeats = false,
): ReadingAction | undefined {
  if (
    !context.active ||
    context.blocked ||
    e.defaultPrevented ||
    e.isComposing ||
    e.altKey
  )
    return;
  let action: ReadingAction | undefined;
  const modifier = e.ctrlKey || e.metaKey;
  if (modifier) {
    if (e.shiftKey) return;
    if (e.key.toLowerCase() === "f") action = "search";
    else if (context.pageFocused && e.key === "Home") action = "first";
    else if (context.pageFocused && e.key === "End") action = "last";
  } else {
    if (context.pageFocused && !e.shiftKey)
      action = (
        {
          ArrowLeft: "previous",
          ArrowRight: "next",
          PageUp: "previous",
          PageDown: "next",
          ArrowUp: "up",
          ArrowDown: "down",
          Home: "top",
          End: "bottom",
        } as Record<string, ReadingAction>
      )[e.key];
    if (!action && context.singleKeys) {
      if (!e.shiftKey)
        action = (
          {
            v: "text",
            b: "box",
            g: "jump",
            "-": "zoomOut",
            "0": "fitPage",
          } as Record<string, ReadingAction>
        )[e.key.toLowerCase()];
      if (e.key === "+" || (e.key === "=" && !e.shiftKey)) action = "zoomIn";
      if (e.shiftKey && (e.code === "Digit0" || e.key === ")" || e.key === "0"))
        action = "fitWidth";
      if (e.key === "?") action = "help";
    }
  }
  if (!includeRepeats && e.repeat && action !== "up" && action !== "down")
    return;
  return action;
}

export const shortcutHelp = [
  ["Ctrl + 滚轮", "缩放课件（鼠标所在位置）"],
  ["V / B", "选字 / 框选"],
  ["Ctrl/Cmd + F", "搜索课件"],
  ["G", "输入页码"],
  ["← / → · Page Up / Down", "上一页 / 下一页"],
  ["↑ / ↓", "页内滚动"],
  ["Home / End", "当前页顶部 / 底部"],
  ["Ctrl/Cmd + Home / End", "第一页 / 最后一页"],
  ["+ / −", "放大 / 缩小"],
  ["0 / Shift + 0", "适合页面 / 适合宽度"],
  ["?", "快捷键帮助"],
  ["Esc", "取消当前操作或关闭最上层界面"],
] as const;
