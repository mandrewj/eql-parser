import { useCallback, useEffect, useRef, useState } from "react";
import type { Fight, LogsResponse, MoteStats, Snapshot } from "./types";

export interface AppData {
  snapshot: Snapshot | null;
  logs: LogsResponse | null;
  connected: boolean;
  selectLog: (path: string) => Promise<void>;
  setLogDir: (dir: string) => Promise<{ ok: boolean; error?: string }>;
  fetchFight: (id: string) => Promise<Fight | null>;
  refreshLogs: () => Promise<void>;
}

/** The server is a **separate long-lived process**, so the browser can be holding a snapshot from
 *  an engine a version behind — `start.command` runs `tsx src/index.ts`, not `tsx watch`, so a
 *  rebuilt UI reaches it while engine changes do not until it is restarted.
 *
 *  A field that engine never sent has to read as empty rather than `undefined`. It came up for
 *  real: `motes.recent` was missing, `.length` on it threw during render, and React unmounted the
 *  **whole app** — a blank page, from one absent array in one tab. Field-by-field rather than a
 *  spread over defaults, so a key present-but-null is covered too.
 */
function motesOf(m?: Partial<MoteStats>): MoteStats {
  return {
    tiers: m?.tiers ?? [],
    grid: m?.grid ?? [],
    perDifficulty: m?.perDifficulty ?? [],
    unknownZone: m?.unknownZone ?? 0,
    windowSize: m?.windowSize ?? 0,
    recent: m?.recent ?? [],
  };
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
          progress: msg.progress ?? { level: null, aaUnspent: null },
          deaths: msg.deaths ?? [],
          stats: msg.stats ?? {
            levels: [],
            aa: [],
            zoneStance: { zone: null, sinceMs: null, melee: [], invocation: [] },
          },
          motes: motesOf(msg.motes),
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
