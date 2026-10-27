import { useEffect, useState } from "react";
import type { Reader } from "./useReader.ts";
import type { Course } from "../shared/types.ts";
import { api } from "./api.ts";
import { Icon } from "./controls.tsx";

export async function connectFolder(r: Reader) {
  const choice = await api<{ root: string; grantId?: string }>("/folders/pick", { method: "POST" });
  if (!choice.grantId) return;
  const course = r.course || await api<Course>("/courses", { method: "POST", body: JSON.stringify({ name: choice.root.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 100) || "新课程" }) });
  await api(`/courses/${course.id}/bind`, { method: "POST", body: JSON.stringify({ grantId: choice.grantId }) });
  await r.refreshCourses(); r.setCourseId(course.id); r.setWorkspaceView("materials");
}
export function Welcome({ r, onGuide, onManual }: { r: Reader; onGuide: () => void; onManual: () => void }) {
  const [busy, setBusy] = useState(false);
  const sample = async () => {
    setBusy(true);
    try {
      const result = await api<{ course: Course }>("/sample", { method: "POST" });
      await Promise.all([r.refreshDocs(), r.refreshCourses(), r.refreshJobs()]);
      r.setCourseId(result.course.id); r.setWorkspaceView("reading"); onGuide();
    } finally { setBusy(false); }
  };
  return <main className="welcome learning-welcome">
    <span className="welcome-eyebrow">POWER POINTER</span>
    <h1>{r.course ? "从第一份课件开始" : "打开课件，留住你的理解"}</h1>
    <p>{r.course ? r.course.name : "在原页旁解释难点、记下思路，下次接着读。"}</p>
    <div className="welcome-entries">
      <button className="welcome-entry" disabled={!r.ready || r.importing} onClick={() => { onGuide(); r.fileInput.current?.click(); }}><Icon name="open" size={25} /><strong>打开课件</strong><span>PDF、PPT 或 PPTX</span></button>
      <button className="welcome-entry" disabled={!r.ready || busy} onClick={() => r.guard(async () => { setBusy(true); try { await connectFolder(r); onGuide(); } finally { setBusy(false); } })}><Icon name="slides" size={25} /><strong>连接课程文件夹</strong><span>选择文件，按章节组织</span></button>
      <button className="welcome-entry" disabled={!r.ready || busy} onClick={() => r.guard(sample)}><Icon name="steps" size={25} /><strong>{busy ? "正在准备…" : "体验示例"}</strong><span>用微积分课件走一遍</span></button>
    </div>
    <p className="welcome-local">阅读和记笔记无需登录，也可以将课件拖到这里。</p>
    <button className="manual-entry-link" onClick={onManual}>查看使用手册 <span aria-hidden="true">→</span></button>
    {r.course && <button onClick={() => r.setWorkspaceView("materials")}>查看资料与导入进度</button>}
  </main>;
}
export function LearningGuide({ r, hasSelection, hasNote, onNotes, onClose, onManual }: { r: Reader; hasSelection: boolean; hasNote: boolean; onNotes: () => void; onClose: () => void; onManual: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => { if (r.doc) setStep(s => Math.max(s, 1)); }, [r.doc?.id]);
  useEffect(() => { if (hasSelection) setStep(s => Math.max(s, 2)); }, [hasSelection]);
  useEffect(() => { if (hasNote) setStep(s => Math.max(s, 3)); }, [hasNote]);
  const steps = [
    ["打开课件", "选择文件，或体验项目自带的微积分示例。"],
    ["选取难点", "拖选文字；遇到公式或图表，可点“框选”。"],
    ["解释，或记下来", "在选区操作栏选择“弹窗解释”或“记笔记”。回答也能存为笔记。"],
    ["下次从笔记继续", "右侧“笔记”可搜索；点击来源能回到原页。"],
  ];
  return <aside className="learning-guide" aria-label="阅读引导"><div className="guide-steps" aria-label={`第 ${step + 1} 步，共 4 步`}>{steps.map((_, i) => <button key={i} aria-current={step === i ? "step" : undefined} onClick={() => setStep(i)}>{i + 1}</button>)}</div><div><strong>{steps[step][0]}</strong><p>{steps[step][1]}</p></div>{step === 3 && <button onClick={onNotes}>打开笔记</button>}<button className="manual-entry-link" onClick={onManual}>使用手册</button><button className="guide-skip" onClick={onClose}>{step === 3 ? "完成引导" : "跳过"}</button></aside>;
}
export function ConnectionSetup({ r, onGuide }: { r: Reader; onGuide: () => void }) {
  const [setup, setSetup] = useState<{ node: { ready: boolean; version: string }; powerpoint: boolean; libreoffice: boolean }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api("/setup").then(setSetup).catch(e => setError(e.message)); }, []);
  const refresh = async () => { setBusy(true); setError(""); try { await Promise.all([r.checkAuth(), api("/setup").then(setSetup)]); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <div className="settings-content connection-setup">
    <h3>Codex 连接</h3><p className="connection-status">{r.auth.authenticated ? `已连接 ChatGPT · ${r.auth.plan || "账户可用"}` : "尚未连接 ChatGPT；也可在模型连接中配置其他服务"}</p>
    <p>点击解释、发送问题或整理章节时，会将所需页面图像、摘录和选定范围内的讨论背景发送给模型。开启联网时也会发送相关搜索词。</p><p className="muted">本地阅读和手写笔记可以直接使用。</p>
    {(r.auth.error || error) && <p className="turn-error" role="alert">{error || r.auth.error}</p>}
    <div className="setup-actions">{!r.auth.authenticated && <button className="primary" disabled={busy} onClick={() => r.guard(async () => { setBusy(true); try { const result = await api("/auth/login", { method: "POST" }); if (result.url) r.setLoginUrl(result.url); else await r.checkAuth(); } finally { setBusy(false); } })}>连接 ChatGPT</button>}<button disabled={busy} onClick={() => void refresh()}>{busy ? "正在检查…" : "重新检查"}</button></div>
    {r.loginUrl && !r.auth.authenticated && <p className="login-link"><a href={r.loginUrl} target="_blank" rel="noopener noreferrer">打开官方登录页面 ↗</a><small>完成后回到这里，连接状态会自动刷新。</small></p>}
    <h3>运行环境</h3>
    <dl className="setup-checks">
      <div><dt>Node.js</dt><dd>{setup ? `${setup.node.ready ? "可用" : "需要更新"} · ${setup.node.version}` : "检查中…"}</dd></div>
      <div><dt>Codex</dt><dd>{r.auth.version ? `已连接 · ${r.auth.version}` : r.auth.error ? "连接失败，请按上方提示处理" : "检查中…"}</dd></div>
      <div><dt>图像模型</dt><dd>{r.models.length ? `${r.models.filter(m => m.capabilities?.vision === true || !m.capabilities && m.inputModalities?.includes("image")).length} 个已确认支持` : r.auth.authenticated ? r.modelError || "正在读取模型列表…" : "配置连接后检查"}</dd></div>
      <div><dt>PowerPoint</dt><dd>{setup ? setup.powerpoint ? "已检测到 · 优先转换" : "未检测到" : "检查中…"}</dd></div>
      <div><dt>LibreOffice</dt><dd>{setup ? setup.libreoffice ? "已检测到 · 兼容转换" : "未检测到" : "检查中…"}</dd></div>
    </dl>
    {setup && !setup.powerpoint && !setup.libreoffice && <p>PDF 可以直接阅读。要打开 PPT/PPTX，请安装 PowerPoint 或 LibreOffice，或先导出 PDF。</p>}
    {r.modelError && r.auth.authenticated && <p className="turn-error">{r.modelError}</p>}
    <button onClick={onGuide}>重新打开阅读引导</button>
  </div>;
}
