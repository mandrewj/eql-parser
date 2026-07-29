import { useCallback, useEffect, useRef, useState } from "react";
import type { Fight, LogsResponse, Snapshot } from "./types";

export interface AppData {
  snapshot: Snapshot | null;
  logs: LogsResponse | null;
  connected: boolean;
  selectLog: (path: string) => Promise<void>;
  setLogDir: (dir: string) => Promise<{ ok: boolean; error?: string }>;
  fetchFight: (id: string) => Promise<Fight | null>;
  refreshLogs: () => Promise<void>;
}

export function useAppData(): AppData {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const refreshLogs = useCallback(async () => {
    try {
      setLogs((await fetch("/api/logs").then((r) => r.json())) as LogsResponse);
    } catch {
      /* backend not up yet */
    }
  }, []);

  useEffect(() => {
    void refreshLogs();
    const es = new EventSource("/events");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { t: string } & Snapshot;
      if (msg.t === "snapshot") {
        setSnapshot({
          current: msg.current,
          recent: msg.recent,
          activeEncounters: msg.activeEncounters,
          recentEncounters: msg.recentEncounters,
          stance: msg.stance,
          stanceOverview: msg.stanceOverview,
          encounterHistory: msg.encounterHistory ?? [],
          milestones: msg.milestones ?? [],
          progressWindows: msg.progressWindows ?? [],
          progress: msg.progress ?? { level: null, abilityPoints: null },
        });
      } else if (msg.t === "activeLogChanged") {
        void refreshLogs();
      }
    };
    return () => es.close();
  }, [refreshLogs]);

  const selectLog = useCallback(
    async (path: string) => {
      await fetch("/api/logs/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, mode: "backfill" }),
      });
      await refreshLogs();
    },
    [refreshLogs],
  );

  const setLogDir = useCallback(async (dir: string): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch("/api/log-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir }),
    });
    const data = await res.json();
    if (res.ok) {
      setLogs(data as LogsResponse);
      return { ok: true };
    }
    return { ok: false, error: (data as { error?: string }).error ?? "failed" };
  }, []);

  const fetchFight = useCallback(async (id: string): Promise<Fight | null> => {
    const res = await fetch(`/api/fights/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as Fight;
  }, []);

  return { snapshot, logs, connected, selectLog, setLogDir, fetchFight, refreshLogs };
}
