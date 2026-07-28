import type { Fight, Filters, FightSummary } from "./types";
import { ALL_TYPES } from "./types";
import { computeRows, durationSec } from "./filters";

const fmt = (n: number) => n.toLocaleString();
const time = (ms: number) => new Date(ms).toLocaleTimeString();

// ---------------------------------------------------------------------------

export function FilterBar({
  filters,
  onChange,
  stances,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  stances: string[];
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggleType = (t: (typeof ALL_TYPES)[number]) =>
    set({ types: { ...filters.types, [t]: !filters.types[t] } });

  return (
    <div className="filterbar">
      <div className="fgroup">
        <span className="flabel">Who</span>
        <button className={filters.showPlayers ? "chip on" : "chip"} onClick={() => set({ showPlayers: !filters.showPlayers })}>
          Players
        </button>
        <button className={filters.showNpcs ? "chip on" : "chip"} onClick={() => set({ showNpcs: !filters.showNpcs })}>
          NPCs
        </button>
      </div>
      <div className="fgroup">
        <span className="flabel">Damage</span>
        {ALL_TYPES.map((t) => (
          <button key={t} className={filters.types[t] ? "chip on" : "chip"} onClick={() => toggleType(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="fgroup">
        <span className="flabel">Stance (self)</span>
        <select value={filters.stance ?? ""} onChange={(e) => set({ stance: e.target.value || null })}>
          <option value="">All</option>
          {stances.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Meter({
  fight,
  filters,
  expanded,
  onToggle,
}: {
  fight: Fight | null;
  filters: Filters;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (!fight) return <div className="idle">No active fight — waiting for combat…</div>;

  const rows = computeRows(fight, filters);
  const dur = Math.round(durationSec(fight));
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="meter">
      <div className="meter-head">
        <span className="fight-title">
          {fight.title} {fight.active && <span className="live-dot" title="active">⚔</span>}
        </span>
        <span className="muted">
          {time(fight.startMs)} · {dur}s · {fight.npcs.length} NPC{fight.npcs.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 && <div className="idle small">No rows match the current filters.</div>}

      {rows.map((r) => {
        const isOpen = expanded.has(r.key);
        return (
          <div key={r.key} className={`row-wrap ${isOpen ? "open" : ""}`}>
            <div className={`bar ${r.kind}`} onClick={() => onToggle(r.key)}>
              <div className="fill" style={{ width: `${(r.total / max) * 100}%` }} />
              <div className="txt">
                <span className="name">
                  {isOpen ? "▾ " : "▸ "}
                  {r.name}
                  {r.stanceFiltered && <span className="tag">{filters.stance}</span>}
                </span>
                <span className="nums">
                  {fmt(r.dps)} dps · {fmt(r.total)} · {r.pct}%
                </span>
              </div>
            </div>
            {isOpen && (
              <div className="drill">
                <div className="drill-meta">
                  {r.hits} hits · {r.crits} crit · {r.misses} miss
                  {!r.stanceFiltered && (
                    <>
                      {" "}
                      · melee {fmt(fightByType(fight, r.name, "melee"))} / spell{" "}
                      {fmt(fightByType(fight, r.name, "spell"))} / dot {fmt(fightByType(fight, r.name, "dot"))}
                    </>
                  )}
                </div>
                {!r.stanceFiltered &&
                  r.abilities.map((a) => (
                    <div key={a.name} className="ability">
                      <span>
                        <span className={`typedot ${a.damageType}`} /> {a.name}
                      </span>
                      <span className="muted">
                        {fmt(a.total)} · x{a.hits}
                        {a.crits ? ` · ${a.crits} crit` : ""}
                      </span>
                    </div>
                  ))}
                {r.isSelf && !r.stanceFiltered && r.stances && r.stances.length > 0 && (
                  <div className="stances">
                    <div className="stances-label">By stance</div>
                    {r.stances.map((s) => (
                      <div key={s.stance} className="ability">
                        <span>⛨ {s.stance}</span>
                        <span className="muted">
                          {fmt(s.total)} · {fmt(s.dps)} dps · {s.activeSeconds}s
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function fightByType(fight: Fight, name: string, t: "melee" | "spell" | "dot"): number {
  return fight.combatants.find((c) => c.name === name)?.byType[t] ?? 0;
}

// ---------------------------------------------------------------------------

export function FightList({
  fights,
  selectedId,
  onSelect,
}: {
  fights: FightSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (fights.length === 0) return <div className="idle small">No fights yet.</div>;
  return (
    <div className="fightlist">
      {fights.map((f) => (
        <button
          key={f.id}
          className={`fitem ${f.id === selectedId ? "sel" : ""} ${f.active ? "active" : ""}`}
          onClick={() => onSelect(f.id)}
        >
          <span className="fitem-title">
            {f.active && <span className="live-dot">⚔</span>} {f.title}
          </span>
          <span className="fitem-meta">
            {time(f.startMs)} · {f.durationSec}s · {fmt(f.topDps)} dps
          </span>
        </button>
      ))}
    </div>
  );
}
