import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CritCategory,
  CritStats,
  Fight,
  LogsResponse,
  MoteStats,
  SkyClass,
  SkyStats,
  Snapshot,
} from "./types";

/** The crit panel's categories, in the order it lists them. Mirrors the engine's own list —
 *  the two have to agree, and the client needs its own copy to rebuild the empty ledger. */
const CRIT_CATEGORIES: readonly CritCategory[] = ["melee", "spell", "dot", "heal", "proc"];

export interface AppData {
  snapshot: Snapshot | null;
  logs: LogsResponse | null;
  connected: boolean;
  /** The Plane of Sky catalogue, fetched once. Null until it arrives, and on an older
   *  server that has no such route — the tab reports that rather than rendering nothing. */
  skyQuests: SkyClass[] | null;
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

/** Same defaulting rule as `motesOf`, for the same reason: a server predating the Sky tracker
 *  sends no `sky` at all, and the tab must read as "nothing held yet" rather than throw. */
function skyOf(s?: Partial<SkyStats>): SkyStats {
  return {
    inventoryPath: s?.inventoryPath ?? null,
    inventoryMs: s?.inventoryMs ?? null,
    inventoryItems: s?.inventoryItems ?? 0,
    held: s?.held ?? [],
    recentLoot: s?.recentLoot ?? [],
    completed: s?.completed ?? [],
  };
}

/** Same defaulting rule again. The five records are rebuilt rather than defaulted to `[]`, so the
 *  badges exist before the first fight and the tab opens as an empty board instead of a blank
 *  pane — which is also what it looks like on a server predating this tab. */
function critsOf(c?: Partial<CritStats>): CritStats {
  const seen = new Map((c?.records ?? []).map((r) => [r.category, r]));
  return {
    records: CRIT_CATEGORIES.map(
      (category) => seen.get(category) ?? { category, best: null, bestHit: null },
    ),
    recent: c?.recent ?? [],
  };
}

export function useAppData(): AppData {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [skyQuests, setSkyQuests] = useState<SkyClass[] | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Once per mount: the catalogue is immutable for the life of the server process.
  useEffect(() => {
    let alive = true;
    void fetch("/api/sky-quests")
      .then((r) => (r.ok ? (r.json() as Promise<SkyClass[]>) : null))
      .then((d) => alive && Array.isArray(d) && setSkyQuests(d))
      .catch(() => {
        /* older server, or backend not up yet */
      });
    return () => {
      alive = false;
    };
  }, []);

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
          sky: skyOf(msg.sky),
          crits: critsOf(msg.crits),
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

  return { snapshot, logs, connected, skyQuests, selectLog, setLogDir, fetchFight, refreshLogs };
}
