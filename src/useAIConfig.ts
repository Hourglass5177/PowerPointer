import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { AIConnection, AssistantProfile, AIUserPreferences } from "../shared/ai.ts";

export interface AIConfiguration { connections: AIConnection[]; assistants: AssistantProfile[]; preferences: AIUserPreferences }
export function useAIConfig(ready: boolean, onChange: () => void) {
  const [config, setConfig] = useState<AIConfiguration>();
  const [error, setError] = useState("");
  const callback = useRef(onChange); callback.current = onChange;
  const refresh = useCallback(async () => { try { const c = await api<AIConfiguration>("/ai/config"); setConfig(c); setError(""); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => {
    if (!ready) return;
    const events = new EventSource("/api/ai/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    events.onmessage = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); callback.current(); }, 100); };
    events.onerror = () => setError("AI 配置连接正在恢复…");
    return () => { events.close(); clearTimeout(timer); };
  }, [ready, refresh]);
  const savePreferences = async (change: Partial<AIUserPreferences>) => {
    if (!config) return;
    const preferences = await api<AIUserPreferences>("/ai/preferences", { method: "PUT", body: JSON.stringify({ ...config.preferences, ...change }) });
    setConfig(c => c ? { ...c, preferences } : c);
  };
  return { config, error, refresh, savePreferences };
}
