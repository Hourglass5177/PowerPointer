import type { Reader } from "./useReader.ts";

export function CourseImports({ r }: { r: Reader }) {
  const files = r.course?.files.filter((f) => f.selected && !r.course?.documentIds.includes(f.documentId || "")) || [];
  if (!files.length) return null;
  const entries = files.map((file) => ({ file, job: r.jobs.find((j) => j.id === file.importJobId) }));
  const failed = entries.filter(({ job }) => job && ["failed", "cancelled"].includes(job.state));
  return (
    <section className="course-imports" aria-label="课程导入进度">
      <p role="status">{r.course?.documentIds.length || 0} 份课件可阅读 · {files.length} 份待导入{failed.length ? ` · ${failed.length} 份需要重试` : ""}</p>
      <p className="muted">已完成的课件可以立即阅读、生成总览；后续导入完成后可更新总览。</p>
      <details open={failed.length > 0}>
        <summary>查看导入进度</summary>
        {entries.map(({ file, job }) => (
          <div className="course-import-row" key={file.path}>
            <span>{file.path}</span>
            <small>{job ? ({ queued: "排队中", processing: "正在转换", completed: "正在更新资料", failed: "导入失败", cancelled: "已取消" })[job.state] : "等待同步"}{job?.error ? `：${job.error}` : ""}</small>
            {job && ["failed", "cancelled"].includes(job.state) && <button onClick={() => r.guard(() => r.retryImport(job.id))}>重试</button>}
          </div>
        ))}
      </details>
    </section>
  );
}
