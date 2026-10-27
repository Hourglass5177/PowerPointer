import { useEffect, useRef, useState } from "react";
import type { Reader } from "./useReader.ts";
import type { Course } from "../shared/types.ts";
import { api } from "./api.ts";
export function CreateCourse({
  r,
  onClose,
}: {
  r: Reader;
  onClose: () => void;
}) {
  const [name, setName] = useState(""),
    [include, setInclude] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const panel = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    panel.current?.querySelector("input")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const items = [
          ...panel.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled)",
          ),
        ];
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <form
        ref={panel}
        className="create-course-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="新建课程"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const c = await api<Course>("/courses", {
              method: "POST",
              body: JSON.stringify({
                name,
                documentIds: include && r.doc ? [r.doc.id] : [],
              }),
            });
            await r.refreshCourses();
            r.setCourseId(c.id);
            r.setWorkspaceView("overview");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>新建课程</h2>
        <label>
          课程名称
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {r.doc && (
          <label className="include-document">
            <input
              type="checkbox"
              checked={include}
              onChange={(e) => setInclude(e.target.checked)}
            />
            <span>加入当前课件：{r.doc.name}</span>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            创建
          </button>
        </div>
      </form>
    </div>
  );
}
