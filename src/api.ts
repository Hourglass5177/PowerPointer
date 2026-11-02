let csrf = "";
export async function bootstrap() {
  const r = await fetch("/api/bootstrap");
  csrf = (await r.json()).csrf;
}
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch("/api" + url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-Lecture-Token": csrf,
      ...options.headers,
    },
  }).catch((e: unknown) => {
    // fetch reports an unreachable server only as a TypeError with an English message.
    if (e instanceof TypeError)
      throw Error("无法连接本地服务，请确认启动窗口仍在运行后重试");
    throw e;
  });
  if (!r.ok) {
    let message = "请求失败";
    try {
      message = (await r.json()).error;
    } catch {}
    throw Object.assign(Error(message), { status: r.status });
  }
  return r.json();
}
export function renderUrl(
  id: string,
  page: number,
  rotation = 0,
  rect?: number[],
  thumb = false,
) {
  return `/api/documents/${id}/render?page=${page}&rotation=${rotation}${rect ? "&rect=" + encodeURIComponent(JSON.stringify(rect)) : ""}${thumb ? "&thumb=1" : ""}`;
}
