import type { ReactNode } from "react";
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    history: "M3 4v5h5 M3 9a9 9 0 1 1 0 7 M12 7v5l3 2",
    expand: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M3 3l6 6 M21 21l-6-6",
    collapse: "M3 8h5V3 M21 16h-5v5 M8 8 2 2 M16 16l6 6",
    copy: "M8 8h12v13H8z M16 8V3H3v13h5",
    edit: "m4 16-1 5 5-1L20 8l-4-4z M13 7l4 4",
    check: "m4 12 5 5L20 6",
    retry: "M20 8V3l-3 3 M20 8h-5 M20 8a9 9 0 1 0 1 7",
    branch:
      "M6 6v12 M6 12h7a5 5 0 0 0 5-5 M3 3h6v6H3z M3 17h6v5H3z M15 2h6v6h-6z",
    down: "m6 9 6 6 6-6",
    pin: "m8 3 8 0-1 6 4 4H5l4-4z M12 13v8",
    archive: "M3 3h18v4H3z M5 7v14h14V7 M9 11h6",
    restore: "M4 5v5h5 M4 10a8 8 0 1 1 1 7 M12 8v5h4",
    list: "M8 5h13 M8 12h13 M8 19h13 M3 5h1 M3 12h1 M3 19h1",
    steps: "M3 18h6v-6h6V6h6 M3 7h4 M3 11h4",
    info: "M12 11v6 M12 7v1 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    globe:
      "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18",
    tools: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    stop: "M6 6h12v12H6z",
    open: "M3 7h6l2 2h10l-3 11H3z M3 7V4h7l2 3h7v2",
    file: "M14 3H5v18h14V8z M14 3v5h5 M8 13h8 M8 17h5",
    search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    box: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M8 8h8v8H8z",
    text: "M5 4h14 M12 4v16 M8 20h8",
    chat: "M3 4h18v13H9l-6 4z",
    slides: "M3 3h5v6H3z M3 13h5v8H3z M12 3h9v18h-9z",
    fit: "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 8h10v8H7z",
    width: "M3 5v14 M21 5v14 M3 12h18 M7 8l-4 4 4 4 M17 8l4 4-4 4",
    rotate: "M20 8V3l-3 3 M20 8h-5 M20 8a9 9 0 1 0 1 7",
    left: "M14 6l-6 6 6 6",
    right: "M10 6l6 6-6 6",
    close: "M6 6l12 12 M18 6 6 18",
    plus: "M12 5v14 M5 12h14",
    send: "M12 20V4 M5 11l7-7 7 7",
    download: "M12 3v12 M8 11l4 4 4-4 M5 16v5h14v-5",
    more: "M4 12h1 M11 12h1 M18 12h1",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}
export function Tool({
  icon,
  children,
  onClick,
  active,
  disabled,
  title,
  shortcut,
}: {
  icon: string;
  children?: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  shortcut?: string;
}) {
  return (
    <button
      className={`tool ${active ? "selected" : ""} ${!children ? "icon-only" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title || (typeof children === "string" ? children : undefined)}
      aria-label={title}
      aria-pressed={active}
      aria-keyshortcuts={shortcut}
    >
      <Icon name={icon} />
      {children && <span>{children}</span>}
    </button>
  );
}
export function ResizeHandle({
  label,
  value,
  min,
  max,
  direction = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction?: number;
  onChange: (v: number) => void;
}) {
  const update = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className="splitter"
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          update(value + (e.key === "ArrowRight" ? 10 : -10) * direction);
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.dataset.start = String(e.clientX);
        e.currentTarget.dataset.value = String(value);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          update(
            Number(e.currentTarget.dataset.value) +
              (e.clientX - Number(e.currentTarget.dataset.start)) * direction,
          );
      }}
    />
  );
}
