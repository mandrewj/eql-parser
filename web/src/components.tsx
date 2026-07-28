import type { Fight, Filters, FightSummary, MetricKind } from "./types";
import { ALL_TYPES } from "./types";
import { computeRows, durationSec, metricMeta } from "./filters";

const fmt = (n: number) => n.toLocaleString();
const time = (ms: number) => new Date(ms).toLocaleTimeString();

const METRICS: Array<{ key: MetricKind; label: string }> = [
  { key: "damage", label: "Damage" },
  { key: "healing", label: "Healing" },
  { key: "taken", label: "Tanking" },
];

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
  const toggleType = (t: (typeof ALL_TYPES)[number]) => set({ types: { ...filters.types, [t]: !filters.types[t] } });
  const { typed, stance: allowStance } = metricMeta(filters.metric);

  return (
    <div className="filterbar">
      <div className="fgroup">
        <span className="flabel">Metric</span>
        {METRICS.map((m) => (
          <button key={m.key} className={filters.metric === m.key ? "chip on" : "chip"} onClick={() => set({ metric: m.key })}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="fgroup">
        <span className="flabel">Who</span>
        <button className={filters.showPlayers ? "chip on" : "chip"} onClick={() => set({ showPlayers: !filters.showPlayers })}>
          Players
        </button>
        <button className={filters.showNpcs ? "chip on" : "chip"} onClick={() => set({ showNpcs: !filters.showNpcs })}>
          NPCs
        </button>
      </div>
      {typed && (
        <div className="fgroup">
          <span className="flabel">Type</span>
          {ALL_TYPES.map((t) => (
            <button key={t} className={filters.types[t] ? "chip on" : "chip"} onClick={() => toggleType(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {allowStance && (
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
      )}
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
  const { unit, label } = metricMeta(filters.metric);
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="meter">
      <div className="meter-head">
        <span className="fight-title">
          {fight.title} {fight.active && <span className="live-dot" title="active">⚔</span>}
        </span>
        <span className="muted">
          {label} · {time(fight.startMs)} · {dur}s
        </span>
      </div>

      {rows.length === 0 && <div className="idle small">No {label.toLowerCase()} matches the current filters.</div>}

      {rows.map((r) => {
        const isOpen = expanded.has(r.key);
        const top = r.entries.slice(0, 10);
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
                  {fmt(r.perSec)} {unit} · {fmt(r.total)} · {r.pct}%
                </span>
              </div>
            </div>
            {isOpen && (
              <div className="drill">
                <div className="drill-meta">
                  {r.hits} hits · {r.crits} crit
                  {filters.metric === "damage" && <> · {r.avoided} miss</>}
                  {filters.metric === "taken" && <> · {r.avoided} avoided</>}
                </div>
                {!r.stanceFiltered && top.length > 0 && (
                  <table className="cats">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="r">Total</th>
                        <th className="r">%</th>
                        <th className="r">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top.map((e) => (
                        <tr key={e.name}>
                          <td>
                            {e.damageType !== "unknown" && <span className={`typedot ${e.damageType}`} />}
                            {e.name}
                          </td>
                          <td className="r">{fmt(e.total)}</td>
                          <td className="r muted">{r.total > 0 ? Math.round((e.total / r.total) * 100) : 0}%</td>
                          <td className="r muted">
                            ×{e.hits}
                            {e.crits ? ` · ${e.crits}c` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {filters.metric === "damage" && r.isSelf && !r.stanceFiltered && r.stances && r.stances.length > 0 && (
                  <div className="stances">
                    <div className="stances-label">Damage by stance</div>
                    <table className="cats">
                      <tbody>
                        {r.stances.map((s) => (
                          <tr key={s.stance}>
                            <td>⛨ {s.stance}</td>
                            <td className="r">{fmt(s.total)}</td>
                            <td className="r muted">{fmt(s.dps)} dps</td>
                            <td className="r muted">{s.activeSeconds}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
