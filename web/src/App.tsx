import { useEffect, useMemo, useState } from "react";
import { useAppData } from "./useAppData";
import { FilterBar, FightList, Meter } from "./components";
import { stancesOf } from "./filters";
import type { Fight, Filters, FightSummary } from "./types";

const DEFAULT_FILTERS: Filters = {
  metric: "damage",
  showPlayers: true,
  showNpcs: false,
  types: { melee: true, spell: true, dot: true },
  stance: null,
};

function currentSummary(f: Fight): FightSummary {
  const topDps = f.combatants.find((c) => c.kind !== "npc")?.damage.perSec ?? 0;
  return {
    id: f.id,
    title: f.title,
    startMs: f.startMs,
    endMs: f.endMs,
    active: f.active,
    durationSec: Math.round(((f.endMs ?? Date.now()) - f.startMs) / 1000),
    topDps,
  };
}

export default function App() {
  const { snapshot, logs, connected, selectLog, setLogDir, fetchFight } = useAppData();
  const [tab, setTab] = useState<"live" | "history">("live");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fight | null>(null);
  const [dirInput, setDirInput] = useState("");
  const [dirError, setDirError] = useState<string | null>(null);

  // Pre-fill the folder field with the detected path once it loads.
  useEffect(() => {
    if (logs?.logDir) setDirInput((prev) => (prev === "" ? logs.logDir! : prev));
  }, [logs?.logDir]);

  const submitDir = async () => {
    setDirError(null);
    const r = await setLogDir(dirInput);
    if (!r.ok) setDirError(r.error ?? "failed");
  };

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // History list: current active fight first, then finished (newest first).
  const history: FightSummary[] = useMemo(() => {
    const list: FightSummary[] = [];
    if (snapshot?.current) list.push(currentSummary(snapshot.current));
    if (snapshot?.recent) list.push(...[...snapshot.recent].reverse());
    return list;
  }, [snapshot]);

  // Resolve the fight shown in the History pane.
  const selectedFight: Fight | null =
    selectedId && snapshot?.current?.id === selectedId ? snapshot.current : fetched;

  useEffect(() => {
    if (tab !== "history" || !selectedId) return;
    if (snapshot?.current?.id === selectedId) return; // live one, no fetch
    let alive = true;
    void fetchFight(selectedId).then((f) => alive && setFetched(f));
    return () => {
      alive = false;
    };
  }, [tab, selectedId, snapshot?.current?.id, fetchFight]);

  const shownFight = tab === "live" ? snapshot?.current ?? null : selectedFight;
  const stances = stancesOf(shownFight);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          EQL Parser <span className="muted small">live DPS</span>
        </div>
        <div className="controls">
          <span className="stancepill" title="current stance">
            ⛨ {snapshot?.stance ?? "—"}
          </span>
          <span className={`conn ${connected ? "on" : ""}`}>{connected ? "live" : "offline"}</span>
        </div>
      </header>

      <div className="logbar">
        <span className="flabel">Logs folder</span>
        <input
          className="dirinput"
          value={dirInput}
          spellCheck={false}
          placeholder="/path/to/EverQuest Legends/logs"
          onChange={(e) => setDirInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitDir();
          }}
        />
        <button className="btn" onClick={() => void submitDir()}>
          Load
        </button>
        {dirError && <span className="err">{dirError}</span>}
        <span className="flabel logbar-log">Log</span>
        <select value={logs?.activeLogPath ?? ""} onChange={(e) => void selectLog(e.target.value)} title="Active log">
          {!logs?.logs.length && <option value="">No logs found</option>}
          {logs?.logs.map((l) => (
            <option key={l.path} value={l.path}>
              {l.character ? `${l.character} (${l.server ?? "?"})` : l.fileName} · {Math.round(l.sizeBytes / 1024)} KB
            </option>
          ))}
        </select>
      </div>

      <nav className="tabs">
        <button className={tab === "live" ? "tab on" : "tab"} onClick={() => setTab("live")}>
          Live
        </button>
        <button className={tab === "history" ? "tab on" : "tab"} onClick={() => setTab("history")}>
          History
        </button>
      </nav>

      <FilterBar filters={filters} onChange={setFilters} stances={stances} />

      {tab === "live" ? (
        <main className="pane">
          <Meter fight={snapshot?.current ?? null} filters={filters} expanded={expanded} onToggle={toggle} />
        </main>
      ) : (
        <main className="pane split">
          <aside className="sidebar">
            <FightList fights={history} selectedId={selectedId} onSelect={setSelectedId} />
          </aside>
          <section className="detail">
            {shownFight ? (
              <Meter fight={shownFight} filters={filters} expanded={expanded} onToggle={toggle} />
            ) : (
              <div className="idle">Select a fight to inspect.</div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
