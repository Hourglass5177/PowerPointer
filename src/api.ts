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
