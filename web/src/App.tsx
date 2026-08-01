import { useEffect, useMemo, useState } from "react";
import { useAppData } from "./useAppData";
import {
  buildComboColors,
  CharacterCard,
  PanelBoundary,
  StatTabs,
  EncounterTable,
  FightList,
  FilterBar,
  StanceOverview,
} from "./components";
import { SkyPanel } from "./sky";
import { metricMeta, rankedCombatants } from "./filters";
import type { Fight, Filters, FightSummary } from "./types";

const DEFAULT_FILTERS: Filters = {
  metric: "damage",
  showPlayers: true,
  showNpcs: false,
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
  const { snapshot, logs, connected, skyQuests, selectLog, setLogDir, fetchFight } = useAppData();
  const [tab, setTab] = useState<"live" | "history" | "sky">("live");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fight | null>(null);
  const [dirInput, setDirInput] = useState("");
  const [dirError, setDirError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    if (logs?.logDir) setDirInput((prev) => (prev === "" ? logs.logDir! : prev));
  }, [logs?.logDir]);

  // Open the log settings automatically when no log is selected yet.
  useEffect(() => {
    if (logs && !logs.activeLogPath) setLogsOpen(true);
  }, [logs?.activeLogPath, logs]);

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

  const history: FightSummary[] = useMemo(() => {
    const list: FightSummary[] = [];
    if (snapshot?.current) list.push(currentSummary(snapshot.current));
    if (snapshot?.recent) list.push(...[...snapshot.recent].reverse());
    return list;
  }, [snapshot]);

  const selectedFight: Fight | null =
    selectedId && snapshot?.current?.id === selectedId ? snapshot.current : fetched;

  useEffect(() => {
    if (tab !== "history" || !selectedId) return;
    if (snapshot?.current?.id === selectedId) return;
    let alive = true;
    void fetchFight(selectedId).then((f) => alive && setFetched(f));
    return () => {
      alive = false;
    };
  }, [tab, selectedId, snapshot?.current?.id, fetchFight]);

  const shownFight = tab === "live" ? snapshot?.current ?? null : selectedFight;
  const { rows, maxima } = rankedCombatants(shownFight, filters);
  const activeEncounters = snapshot?.activeEncounters ?? [];
  const recentEncounters = snapshot?.recentEncounters ?? [];
  // One combo → colour map for the whole pane: the encounter timelines and the My DPS chart
  // have to agree, or the stance swatches stop working as a legend for either.
  const comboColors = buildComboColors(
    snapshot?.encounterHistory ?? [],
    snapshot?.stanceOverview.find((w) => w.n === 25)?.rows ?? [],
    [...activeEncounters, ...recentEncounters].flatMap((e) => e.sparkCombos ?? []),
  );
  const rankLabel = metricMeta(filters.metric).label;
  const activeLog = logs?.logs.find((l) => l.path === logs.activeLogPath);

  const cards = (
    <section className="block">
      <div className="section-title">Characters — ranked by {rankLabel}</div>
      {rows.length ? (
        <div className="card-grid">
          {rows.map((c) => (
            <CharacterCard
              key={c.name}
              c={c}
              filters={filters}
              maxima={maxima}
              expanded={expanded.has(c.name)}
              onToggle={() => toggle(c.name)}
            />
          ))}
        </div>
      ) : (
        <div className="idle small">No matching characters.</div>
      )}
    </section>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          EQL Parser
          {activeLog?.character && (
            <span className="who">
              {activeLog.character}
              {activeLog.server && <span className="muted"> · {activeLog.server}</span>}
            </span>
          )}
        </div>
        <div className="controls">
          <span className="stancepill" title="melee stance">
            ⚔ {snapshot?.stance.melee && snapshot.stance.melee !== "none" ? snapshot.stance.melee : "—"}
          </span>
          <span className="stancepill" title="invocation (caster stance)">
            ✦ {snapshot?.stance.invocation && snapshot.stance.invocation !== "none" ? snapshot.stance.invocation : "—"}
          </span>
          <span className={`conn ${connected ? "on" : ""}`}>{connected ? "live" : "offline"}</span>
          <button
            className={logsOpen ? "iconbtn on" : "iconbtn"}
            title="Log settings"
            onClick={() => setLogsOpen((v) => !v)}
          >
            ⚙
          </button>
        </div>
      </header>

      {logsOpen && (
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
      )}

      <nav className="tabs">
        <button className={tab === "live" ? "tab on" : "tab"} onClick={() => setTab("live")}>
          Live
        </button>
        <button className={tab === "history" ? "tab on" : "tab"} onClick={() => setTab("history")}>
          History
        </button>
        <button className={tab === "sky" ? "tab on" : "tab"} onClick={() => setTab("sky")}>
          Sky
        </button>
      </nav>

      {tab === "sky" ? (
        <main className="pane wide">
          <PanelBoundary name="Plane of Sky">
            <SkyPanel
              catalogue={skyQuests}
              sky={snapshot?.sky ?? { inventoryPath: null, inventoryMs: null, inventoryItems: 0, held: [], recentLoot: [] }}
            />
          </PanelBoundary>
        </main>
      ) : tab === "live" ? (
        <main className="pane wide">
          <StanceOverview
            windows={snapshot?.stanceOverview ?? []}
            history={snapshot?.encounterHistory ?? []}
            stance={snapshot?.stance ?? null}
            milestones={snapshot?.milestones ?? []}
            progressWindows={snapshot?.progressWindows ?? []}
            progress={snapshot?.progress ?? { level: null, aaUnspent: null }}
          />
          {snapshot?.stats && (
            <PanelBoundary name="Stats">
              <StatTabs stats={snapshot.stats} deaths={snapshot.deaths ?? []} motes={snapshot.motes} />
            </PanelBoundary>
          )}
          {activeEncounters.length > 0 && (
            <section className="block">
              <div className="section-title live">
                <span className="live-dot">⚔</span> Active · {activeEncounters.length}
              </div>
              {activeEncounters.map((e, i) => (
                <EncounterTable
                  key={e.id}
                  enc={e}
                  expanded={expanded}
                  onToggle={toggle}
                  showHead={i === 0}
                  colors={comboColors}
                />
              ))}
            </section>
          )}
          {recentEncounters.length > 0 ? (
            <section className="block">
              <div className="section-title">Last {recentEncounters.length} encounters</div>
              {recentEncounters.map((e, i) => (
                <EncounterTable
                  key={e.id}
                  enc={e}
                  expanded={expanded}
                  onToggle={toggle}
                  showHead={i === 0}
                  colors={comboColors}
                />
              ))}
            </section>
          ) : (
            activeEncounters.length === 0 && <div className="idle">No combat yet — waiting for a fight…</div>
          )}
        </main>
      ) : (
        <main className="pane split">
          <aside className="sidebar">
            <FightList fights={history} selectedId={selectedId} onSelect={setSelectedId} />
          </aside>
          <section className="detail">
            {shownFight ? (
              <>
                <FilterBar filters={filters} onChange={setFilters} />
                {cards}
              </>
            ) : (
              <div className="idle">Select a fight to inspect.</div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
