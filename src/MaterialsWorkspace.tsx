import { useEffect, useMemo, useState } from "react";
import type { Reader } from "./useReader.ts";
import type { ReadingWindows } from "./useReadingWindows.ts";
import { api } from "./api.ts";
import type { Course } from "../shared/types.ts";
import { Icon } from "./controls.tsx";
import { CourseImports } from "./CourseImports.tsx";
import { chapterName } from "../shared/learning.ts";
import { connectFolder } from "./Onboarding.tsx";
export function MaterialsWorkspace({
  r,
  windows: w,
  onCreate,
}: {
  r: Reader;
  windows: ReadingWindows;
  onCreate: () => void;
}) {
  const course = r.course,
    selected = r.courseId;
  const [tab, setTab] = useState("课程"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [query, setQuery] = useState(""), [groupName, setGroupName] = useState("");
  const [impact, setImpact] = useState<{
      id: string;
      name: string;
      conversations: number;
      referencedConversations: number;
      windows: number;
      courses: string[];
    } | null>(null),
    [deleteChats, setDeleteChats] = useState(false),
    [removed, setRemoved] = useState("");
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    await Promise.all([r.refreshCourses(), r.refreshDocs()]);
  };
  useEffect(() => {
    if (!course) {
      setPaths([]);
      return;
    }
    const removed = new Set(
      course.changes
        .filter((c) => c.type === "deleted" || c.type === "moved")
        .map((c) => (c.type === "moved" ? c.from! : c.path)),
    );
    setPaths(
      course.files
        .filter((f) => f.selected && !removed.has(f.path))
        .map((f) => f.path)
        .concat(
          course.changes
            .filter(
              (c) =>
                c.type === "moved" &&
                course.files.find((f) => f.path === c.from)?.selected,
            )
            .map((c) => c.path),
        ),
    );
  }, [selected, course?.scanId, course?.files.map((f) => `${f.path}:${f.selected}`).join("|")]);
  const files = useMemo(() => {
    if (!course) return [];
    const removed = new Set(
      course.changes
        .filter((c) => c.type === "deleted" || c.type === "moved")
        .map((c) => (c.type === "moved" ? c.from! : c.path)),
    );
    const map = new Map(
      course.files
        .filter((f) => !removed.has(f.path))
        .map((f) => {
          const job = r.jobs.find((j) => j.id === f.importJobId);
          const status = !f.selected ? "未选择" : f.documentId && course.documentIds.includes(f.documentId) ? "可阅读" :
            job ? ({ queued: "排队中", processing: "正在转换", completed: "正在更新资料", failed: "导入失败", cancelled: "已取消" })[job.state] : "待同步";
          return [f.path, { path: f.path, status }];
        }),
    );
    for (const c of course.changes)
      if (c.type !== "deleted")
        map.set(c.path, {
          path: c.path,
          status:
            { added: "新增", modified: "修改", moved: "移动" }[c.type] +
            (c.from ? ` ← ${c.from}` : ""),
        });
    return [...map.values()].sort((a, b) =>
      a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
    );
  }, [course, r.jobs]);
  const patchCourse = async (patch: Partial<Course>) => {
    if (!course) return;
    await api(`/courses/${course.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await r.refreshCourses();
  };
  useEffect(() => {
    if (impact) {
      const panel = document.querySelector<HTMLElement>(".delete-impact");
      panel?.scrollIntoView({ block: "center" });
      panel?.focus();
    }
  }, [impact?.id]);
  const onClose = () => r.setWorkspaceView("reading");
  const matches = (id: string) => {
    const doc = r.documents.find(d => d.id === id);
    return !query.trim() || `${doc?.name || ""} ${doc ? chapterName(course, doc) : ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  };
  const visibleIds = course?.documentIds.filter(matches) || [];
  return (
    <main className="workspace-page materials-page" aria-busy={busy}>
      <header className="page-heading">
        <div>
          <h1>资料</h1>
          <p>{course?.name || "独立课件"}</p>
        </div>
        <div className="page-actions"><button disabled={busy} onClick={() => void perform(() => connectFolder(r))}><Icon name="open" size={16} />{course?.root ? "更换目录" : "连接目录"}</button><button
          className={course?.changes.length ? "" : "primary"}
          onClick={() => r.fileInput.current?.click()}
        >
          添加文件
        </button>
        </div>
      </header>
      <div className="materials-tools"><label className="materials-search"><Icon name="search" size={16} /><input aria-label="搜索课件" placeholder="搜索章节或文件名" value={query} onChange={e => setQuery(e.target.value)} /></label>{course && tab === "课程" && <details className="popover"><summary>批量操作</summary><div className="popover-panel"><button disabled={busy || !visibleIds.length} onClick={() => void perform(() => patchCourse({ selectedDocumentIds: [...new Set([...course.selectedDocumentIds, ...visibleIds])] }))}>全部参与课程问答</button><button disabled={busy || !visibleIds.length} onClick={() => void perform(() => patchCourse({ selectedDocumentIds: course.selectedDocumentIds.filter(id => !visibleIds.includes(id)) }))}>取消当前列表的问答来源</button></div></details>}</div>
      <div className="view-tabs">
        <button aria-pressed={tab === "课程"} onClick={() => setTab("课程")}>
          当前课程
        </button>
        <button
          aria-pressed={tab === "资料库"}
          onClick={() => setTab("资料库")}
        >
          全部资料
        </button>
      </div>
      {message && (
        <p role="status" className="library-message">
          {message}
        </p>
      )}
      {tab === "课程" ? (
        course ? (
          <>
            <CourseImports r={r} />
            {" "}
            <section className="course-section">
              <div className="course-section-heading">
                <h3>课程章节</h3>
                <span>已导入 {course.documentIds.length} 份 · 勾选的 {course.selectedDocumentIds.length} 份参与课程问答</span>
              </div>
              {!course.documentIds.length && <p className="muted">尚无可阅读的课件。绑定目录后，请在下方勾选文件并确认同步。</p>}
              <details className="theme-manager"><summary>主题分组 · {(course.groups || []).length} 个</summary><div>{(course.groups || []).map((group, i) => <div className="theme-row" key={group.id}><input aria-label={`主题名称 ${group.name}`} defaultValue={group.name} maxLength={100} onBlur={e => { const name = e.target.value.trim(); if (name && name !== group.name) void perform(() => patchCourse({ groups: course.groups!.map(g => g.id === group.id ? { ...g, name } : g) })); }} /><small>{group.documentIds.length} 章</small><button disabled={!i || busy} aria-label={`上移主题 ${group.name}`} onClick={() => void perform(() => { const groups = [...course.groups!]; [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]]; return patchCourse({ groups }); })}>↑</button><button disabled={busy} onClick={() => void perform(() => patchCourse({ groups: course.groups!.filter(g => g.id !== group.id) }))}>移除分组</button></div>)}</div><form onSubmit={e => { e.preventDefault(); if (groupName.trim()) void perform(async () => { await patchCourse({ groups: [...(course.groups || []), { id: crypto.randomUUID(), name: groupName.trim(), documentIds: [] }] }); setGroupName(""); }); }}><input aria-label="新主题名称" value={groupName} maxLength={100} onChange={e => setGroupName(e.target.value)} placeholder="例如：基础概念" /><button disabled={busy || !groupName.trim()}>添加主题</button></form><p className="muted">在章节的更多操作中分配主题。移除分组后，章节仍留在课程中。</p></details>
              {course.documentIds.map((id, index) => {
                const doc = r.documents.find((d) => d.id === id);
                if (!matches(id)) return null;
                return (
                  <div className="course-source" key={id}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`知识来源 ${doc?.name || id}`}
                        checked={course.selectedDocumentIds.includes(id)}
                        disabled={busy}
                        onChange={(e) =>
                          void perform(() =>
                            patchCourse({
                              selectedDocumentIds: e.target.checked
                                ? [...course.selectedDocumentIds, id]
                                : course.selectedDocumentIds.filter(
                                    (d) => d !== id,
                                  ),
                            }),
                          )
                        }
                      />
                      <span>
                        {doc ? chapterName(course, doc) : "来源已删除"}
                        <small>
                          {doc?.pages || 0} 页 · 已导入{doc && chapterName(course, doc) !== doc.name ? ` · ${doc.name}` : ""}
                          {course.files.find((f) => f.documentId === id)
                            ? ` · ${course.files.find((f) => f.documentId === id)!.path}`
                            : ""}
                        </small>
                      </span>
                    </label>
                    <button
                      disabled={!doc}
                      aria-label={`打开 ${doc?.name || "课件"}`}
                      onClick={() => { r.setDocId(id); r.setWorkspaceView("reading"); }}
                    >打开</button>
                    <details className="popover chapter-more"><summary aria-label={`更多操作 ${doc?.name}`}><Icon name="more" size={18} /></summary><div className="popover-panel">
                    <label>章节显示名<input aria-label={`章节显示名 ${doc?.name}`} defaultValue={doc ? chapterName(course, doc) : ""} maxLength={200} onBlur={e => { const name = e.target.value.trim(); if (name && name !== chapterName(course, doc!)) void perform(() => patchCourse({ displayNames: { ...course.displayNames, [id]: name } })); }} /></label>
                    <label>主题<select aria-label={`章节主题 ${doc?.name}`} value={course.groups?.find(g => g.documentIds.includes(id))?.id || ""} disabled={busy} onChange={e => { const groupId = e.target.value; void perform(() => patchCourse({ groups: (course.groups || []).map(g => ({ ...g, documentIds: g.id === groupId ? [...new Set([...g.documentIds, id])] : g.documentIds.filter(x => x !== id) })) })); }}><option value="">未分组</option>{course.groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
                    <button
                      title="上移章节"
                      aria-label={`上移 ${doc?.name}`}
                      disabled={!index || busy}
                      onClick={() =>
                        void perform(async () => {
                          const ids = [...course.documentIds];
                          [ids[index - 1], ids[index]] = [
                            ids[index],
                            ids[index - 1],
                          ];
                          await patchCourse({
                            documentIds: ids,
                            selectedDocumentIds: ids.filter((x) =>
                              course.selectedDocumentIds.includes(x),
                            ),
                          });
                        })
                      }
                    >
                      上移章节
                    </button>
                    <button
                      title="从课程移除，保留应用内课件"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          patchCourse({
                            documentIds: course.documentIds.filter(
                              (d) => d !== id,
                            ),
                            selectedDocumentIds:
                              course.selectedDocumentIds.filter(
                                (d) => d !== id,
                              ),
                          }),
                        )
                      }
                    >
                      从课程移除
                    </button>
                    </div></details>
                  </div>
                );
              })}
              <select
                aria-label="从资料库加入课程"
                value=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value)
                    void perform(() =>
                      patchCourse({
                        documentIds: [...course.documentIds, e.target.value],
                        selectedDocumentIds: [
                          ...course.selectedDocumentIds,
                          e.target.value,
                        ],
                      }),
                    );
                }}
              >
                <option value="">从资料库加入课件</option>
                {r.documents
                  .filter((d) => !course.documentIds.includes(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </section>
            <section className="course-section directory-section">
              <div className="course-section-heading">
                <h3>硬盘目录</h3>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const choice = await api<{
                        root: string;
                        grantId?: string;
                      }>("/folders/pick", { method: "POST" });
                      if (choice.grantId) {
                        await api(`/courses/${course.id}/bind`, {
                          method: "POST",
                          body: JSON.stringify({
                            grantId: choice.grantId,
                          }),
                        });
                        await refresh();
                      }
                    })
                  }
                >
                  {course.root ? "重新绑定" : "绑定目录"}
                </button>
              </div>
              {course.root ? (
                <>
                  <p className="directory-path">{course.root}</p>
                  <div className="course-inline-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(`/courses/${course.id}/scan`, {
                            method: "POST",
                          });
                          await refresh();
                        })
                      }
                    >
                      检查变更
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(`/courses/${course.id}/unbind`, {
                            method: "POST",
                          });
                          await refresh();
                        })
                      }
                    >
                      解绑目录
                    </button>
                    <small>
                      {course.checkedAt
                        ? `上次检查 ${new Date(course.checkedAt).toLocaleTimeString()}`
                        : "正在检查"}
                    </small>
                  </div>
                  {course.offline ? (
                    <p className="turn-error">
                      {course.offline}
                      。已有课件仍可阅读；请恢复路径或重新绑定。
                    </p>
                  ) : (
                    <details
                      className="directory-changes"
                      open={course.changes.length > 0}
                    >
                      <summary>
                        {course.changes.length
                          ? `${course.changes.length} 项变更待确认`
                          : "查看目录文件与同步选择"}
                      </summary>
                      <div className="directory-file-list">
                        {files.map((f) => (
                          <label key={f.path}>
                            <input
                              type="checkbox"
                              checked={paths.includes(f.path)}
                              onChange={(e) =>
                                setPaths((ps) =>
                                  e.target.checked
                                    ? [...ps, f.path]
                                    : ps.filter((p) => p !== f.path),
                                )
                              }
                            />
                            <span>{f.path}</span>
                            <small>{f.status}</small>
                          </label>
                        ))}
                        {course.changes
                          .filter((c) => c.type === "deleted")
                          .map((c) => (
                            <div className="deleted-path" key={c.path}>
                              {c.path}
                              <small>已从目录删除 · 应用内旧版本保留</small>
                            </div>
                          ))}
                      </div>
                      <div className="course-inline-actions">
                        <button
                          onClick={() => setPaths(files.map((f) => f.path))}
                        >
                          全选
                        </button>
                        <button onClick={() => setPaths([])}>清空选择</button>
                        <button
                          className="primary"
                          disabled={busy || !course.scanId}
                          onClick={() =>
                            void perform(async () => {
                              await api(`/courses/${course.id}/sync`, {
                                method: "POST",
                                body: JSON.stringify({
                                  scanId: course.scanId,
                                  paths,
                                }),
                              });
                              await refresh();
                              setMessage(
                                "已确认同步。导入进度会在本页自动更新，完成后可点击打开。",
                              );
                            })
                          }
                        >
                          确认同步 {paths.length} 份文件
                        </button>
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p>绑定目录并选择课件，变更确认后同步。原文件保留。</p>
              )}
            </section>
          </>
        ) : (
          <div className="workspace-empty">
            <h2>尚未选择课程</h2>
            <p>创建课程，将课件放在一起阅读。</p>
            <button onClick={onCreate}>新建课程</button>
          </div>
        )
      ) : (
        <>
          {" "}
          {removed && (
            <button
              onClick={() =>
                void perform(async () => {
                  await api(`/documents/${removed}/recent`, {
                    method: "POST",
                    body: JSON.stringify({ hidden: false }),
                  });
                  setRemoved("");
                  await r.refreshDocs();
                })
              }
            >
              撤销最近移除
            </button>
          )}
          {r.documents.filter(doc => matches(doc.id)).map((doc) => (
            <div className="library-document" key={doc.id}>
              <Icon name="file" />
              <button
                className="library-doc-name"
                onClick={() =>
                  void perform(async () => {
                    await api(`/documents/${doc.id}/recent`, {
                      method: "POST",
                      body: JSON.stringify({ hidden: false }),
                    });
                    if (!course?.documentIds.includes(doc.id))
                      r.setCourseId("");
                    r.setDocId(doc.id);
                    await r.refreshDocs();
                    onClose();
                  })
                }
              >
                <strong>{doc.name}</strong>
                <small>
                  {doc.pages} 页 · {doc.sourceFormat?.toUpperCase() || "PDF"}
                  {doc.hiddenRecent ? " · 已从最近移除" : ""}
                </small>
              </button>
              <details className="popover"><summary aria-label={`资料操作 ${doc.name}`}><Icon name="more" size={18} /></summary><div className="popover-panel"><button
                disabled={doc.hiddenRecent || busy}
                onClick={() =>
                  void perform(async () => {
                    await api(`/documents/${doc.id}/recent`, {
                      method: "POST",
                      body: JSON.stringify({ hidden: true }),
                    });
                    setRemoved(doc.id);
                    await r.refreshDocs();
                  })
                }
              >
                最近移除
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const v = await api(`/documents/${doc.id}/impact`);
                    setDeleteChats(false);
                    setImpact({ ...v, id: doc.id });
                  })
                }
              >
                彻底删除…
              </button>
              </div></details>
            </div>
          ))}
          {!r.documents.length && <p>还没有导入的课件。</p>}
          {impact && (
            <div
              className="delete-impact"
              tabIndex={-1}
              role="alertdialog"
              aria-label="确认删除课件"
            >
              <h3>删除“{impact.name}”？</h3>
              <p>
                将清理应用内副本、检索索引和知识来源。以此课件为主的有{" "}
                {impact.conversations} 个会话、{impact.windows} 个解释窗
                {impact.courses.length
                  ? `，课程：${impact.courses.join("、")}`
                  : ""}
                。{impact.referencedConversations || 0} 个会话含有此课件的引用。
              </p>
              <p>硬盘原文件保留。默认保留旧问答，引用标记为“来源已删除”。</p>
              <label>
                <input
                  type="checkbox"
                  checked={deleteChats}
                  onChange={(e) => setDeleteChats(e.target.checked)}
                />
                同时删除此课件的正式会话和解释窗
              </label>
              <div>
                <button disabled={busy} onClick={() => setImpact(null)}>
                  取消
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api(`/documents/${impact.id}`, {
                        method: "DELETE",
                        body: JSON.stringify({ deleteChats }),
                      });
                      if (deleteChats)
                        for (const key of Object.keys(localStorage))
                          if (
                            key.startsWith("lecture-draft-") &&
                            key.includes(impact.id)
                          )
                            localStorage.removeItem(key);
                      setImpact(null);
                      await refresh();
                      setMessage("已删除应用内资料；硬盘原文件保留。");
                    })
                  }
                >
                  删除应用内资料
                </button>
              </div>
            </div>
          )}
        </>
      )}{" "}
      {!!w.cleanup.length && (
        <div className="cleanup-status">
          <p>
            有 {w.cleanup.length}{" "}
            项模型线程或本地副本待清理。被删除的问答已移除。
          </p>
          {w.cleanup.some((c) => c.error) && (
            <p>{w.cleanup.find((c) => c.error)?.error}</p>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await api("/cleanup/retry", { method: "POST" });
              })
            }
          >
            重试清理
          </button>
        </div>
      )}
    </main>
  );
}
