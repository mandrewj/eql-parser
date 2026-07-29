import type {
  CombatantStats,
  Encounter,
  EncounterCard as EncounterCardData,
  Filters,
  FightSummary,
  MetricKind,
  MetricStat,
  RecentEncounter,
  StanceBreakdown,
} from "./types";
import { metricMeta } from "./filters";

const fmt = (n: number) => n.toLocaleString();
const time = (ms: number) => new Date(ms).toLocaleTimeString();

const METRICS: Array<{ key: MetricKind; label: string }> = [
  { key: "damage", label: "Damage" },
  { key: "healing", label: "Healing" },
  { key: "taken", label: "Tanking" },
];

// ---------------------------------------------------------------------------

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <div className="filterbar">
      <div className="fgroup">
        <span className="flabel">Rank by</span>
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
    </div>
  );
}

// ---------------------------------------------------------------------------

export function EncounterPane({ encounter }: { encounter: Encounter }) {
  const max = Math.max(1, ...encounter.attackers.map((a) => a.total));
  return (
    <div className={`encounter ${encounter.active ? "live" : "dead"}`}>
      <div className="enc-head">
        <span className="enc-name">
          {encounter.active && <span className="live-dot">⚔</span>} {encounter.name}
        </span>
        <span className="enc-dps">
          {fmt(encounter.dps)} dps · {fmt(encounter.total)}
        </span>
      </div>
      {encounter.attackers.map((a) => (
        <div key={a.name} className={`enc-bar ${a.isSelf ? "self" : "player"}`}>
          <div className="fill" style={{ width: `${(a.total / max) * 100}%` }} />
          <div className="txt">
            <span className="name">{a.name}</span>
            <span className="nums">
              {fmt(a.dps)} · {a.pct}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MetricLine({
  icon,
  stat,
  unit,
  accent,
  active,
  max,
}: {
  icon: string;
  stat: MetricStat;
  unit: string;
  accent: string;
  active: boolean;
  max: number;
}) {
  return (
    <div className={`mline ${active ? "on" : ""}`}>
      <span className="micon">{icon}</span>
      <div className={`mbar ${accent}`}>
        <div className="fill" style={{ width: `${(stat.total / max) * 100}%` }} />
      </div>
      <span className="mval">
        {fmt(stat.perSec)} <span className="munit">{unit}</span>
      </span>
      <span className="mtot">{fmt(stat.total)}</span>
    </div>
  );
}

function StanceTable({ icon, label, rows }: { icon: string; label: string; rows: StanceBreakdown[] }) {
  if (!rows.some((s) => s.stance !== "none")) return null; // dimension never used
  return (
    <div className="stances">
      <div className="stances-label">{label}</div>
      <table className="cats">
        <tbody>
          {rows.map((s) => (
            <tr key={s.stance}>
              <td>
                {icon} {s.stance === "none" ? "(none)" : s.stance}
              </td>
              <td className="r">{fmt(s.total)}</td>
              <td className="r muted">{fmt(s.dps)} dps</td>
              <td className="r muted">{s.activeSeconds}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CharacterCard({
  c,
  filters,
  maxima,
  expanded,
  onToggle,
}: {
  c: CombatantStats;
  filters: Filters;
  maxima: Record<MetricKind, number>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const metric = filters.metric;
  const m = c[metric];
  const meta = metricMeta(metric);
  return (
    <div className={`card ${c.kind} ${c.isSelf ? "is-self" : ""} ${expanded ? "open" : ""}`}>
      <div className="card-head" onClick={onToggle}>
        <span className="card-name">
          {expanded ? "▾ " : "▸ "}
          {c.name}
          {c.kind === "pet" && <span className="tag">🐾 {c.ownerName ? `${c.ownerName}'s` : "pet"}</span>}
          {c.isSelf && <span className="tag you">you</span>}
        </span>
        <span className="card-kind">{c.kind}</span>
      </div>
      <MetricLine icon="⚔" stat={c.damage} unit="dps" accent="dmg" active={metric === "damage"} max={maxima.damage} />
      <MetricLine icon="✚" stat={c.healing} unit="hps" accent="heal" active={metric === "healing"} max={maxima.healing} />
      <MetricLine icon="🛡" stat={c.taken} unit="dps" accent="tank" active={metric === "taken"} max={maxima.taken} />

      {expanded && (
        <div className="card-drill">
          <div className="drill-title">{meta.label} breakdown</div>
          {metric === "damage" && (
            <div className="drill-meta">
              melee {fmt(c.damage.byType.melee)} · spell {fmt(c.damage.byType.spell)} · dot {fmt(c.damage.byType.dot)} · {c.damage.crits} crit ·{" "}
              {c.damage.avoided} miss
            </div>
          )}
          {metric === "taken" && (
            <div className="drill-meta">
              melee {fmt(c.taken.byType.melee)} · spell {fmt(c.taken.byType.spell)} · dot {fmt(c.taken.byType.dot)} · {c.taken.avoided} avoided
            </div>
          )}
          {m.entries.length > 0 ? (
            <table className="cats">
              <tbody>
                {m.entries.slice(0, 10).map((e) => (
                  <tr key={e.name}>
                    <td>
                      {e.damageType !== "unknown" && <span className={`typedot ${e.damageType}`} />}
                      {e.name}
                    </td>
                    <td className="r">{fmt(e.total)}</td>
                    <td className="r muted">{m.total > 0 ? Math.round((e.total / m.total) * 100) : 0}%</td>
                    <td className="r muted">
                      ×{e.hits}
                      {e.crits ? ` · ${e.crits}c` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted small">No {meta.label.toLowerCase()} recorded.</div>
          )}
          {metric === "damage" && c.isSelf && c.stances && (
            <>
              <StanceTable icon="⚔" label="Damage by melee stance" rows={c.stances.melee} />
              <StanceTable icon="✦" label="Damage by invocation" rows={c.stances.invocation} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// --- per-mob encounter sections (grouped stats) ---------------------------

function EncounterCharCard({
  card,
  encTotal,
  max,
  open,
  onToggle,
}: {
  card: EncounterCardData;
  encTotal: number;
  max: number;
  open: boolean;
  onToggle: () => void;
}) {
  const d = card.damage;
  const pct = encTotal > 0 ? Math.round((d.total / encTotal) * 100) : 0;
  return (
    <div className={`card ${card.isSelf ? "is-self" : ""} ${open ? "open" : ""}`}>
      <div className="card-head" onClick={onToggle}>
        <span className="card-name">
          {open ? "▾ " : "▸ "}
          {card.name}
          {card.isSelf && <span className="tag you">you</span>}
        </span>
        <span className="card-kind">{pct}%</span>
      </div>
      <div className="mline on">
        <span className="micon">⚔</span>
        <div className="mbar dmg">
          <div className="fill" style={{ width: `${(d.total / max) * 100}%` }} />
        </div>
        <span className="mval">
          {fmt(d.perSec)} <span className="munit">dps</span>
        </span>
        <span className="mtot">{fmt(d.total)}</span>
      </div>
      {open && (
        <div className="card-drill">
          <div className="drill-meta">
            melee {fmt(d.byType.melee)} · spell {fmt(d.byType.spell)} · dot {fmt(d.byType.dot)} · {d.crits} crit · took{" "}
            {fmt(card.taken.total)} from mob
          </div>
          {d.entries.length > 0 && (
            <table className="cats">
              <tbody>
                {d.entries.slice(0, 8).map((e) => (
                  <tr key={e.name}>
                    <td>
                      {e.damageType !== "unknown" && <span className={`typedot ${e.damageType}`} />}
                      {e.name}
                    </td>
                    <td className="r">{fmt(e.total)}</td>
                    <td className="r muted">
                      ×{e.hits}
                      {e.crits ? ` · ${e.crits}c` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function EncounterSection({
  enc,
  expanded,
  onToggle,
}: {
  enc: RecentEncounter;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const max = Math.max(1, ...enc.cards.map((c) => c.damage.total));
  const dps = Math.round(enc.total / Math.max(1, enc.durationSec));
  return (
    <section className="enc-section">
      <div className="enc-section-head">
        <span className="enc-section-name">{enc.name}</span>
        <span className="muted">
          {time(enc.endMs)} · {enc.durationSec}s · {fmt(enc.total)} dmg · {fmt(dps)} dps
        </span>
      </div>
      <div className="card-grid">
        {enc.cards.map((c) => (
          <EncounterCharCard
            key={c.name}
            card={c}
            encTotal={enc.total}
            max={max}
            open={expanded.has(`${enc.id}:${c.name}`)}
            onToggle={() => onToggle(`${enc.id}:${c.name}`)}
          />
        ))}
      </div>
    </section>
  );
}

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
