import type {
  CombatantStats,
  EncounterCard as EncounterCardData,
  EncounterView,
  Filters,
  FightSummary,
  MetricKind,
  MetricStat,
  StanceBreakdown,
  StanceOverviewRow,
} from "./types";
import { metricMeta } from "./filters";

const fmt = (n: number) => n.toLocaleString();
const fmtK = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString());
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

// --- overview: my DPS by stance+invocation combination --------------------

const stanceLabel = (s: string) => (s === "none" ? "—" : s);

export function StanceOverview({ rows }: { rows: StanceOverviewRow[] }) {
  if (rows.length === 0) return null;
  const totalDmg = rows.reduce((s, r) => s + r.damage, 0);
  const totalSec = rows.reduce((s, r) => s + r.seconds, 0);
  const overall = Math.round(totalDmg / Math.max(1, totalSec));
  const maxDps = Math.max(1, ...rows.map((r) => r.dps));
  return (
    <section className="overview">
      <div className="ov-head">
        <span className="ov-title">My DPS · by stance</span>
        <span className="ov-overall">
          {fmtK(overall)} <span className="munit">avg dps</span>
        </span>
      </div>
      {rows.map((r) => (
        <div key={`${r.melee}|${r.invocation}`} className="ov-row">
          <div className="ov-bar">
            <div className="fill" style={{ width: `${(r.dps / maxDps) * 100}%` }} />
            <div className="ov-txt">
              <span className="ov-combo">
                ⚔ {stanceLabel(r.melee)} · ✦ {stanceLabel(r.invocation)}
              </span>
              <span className="ov-dps">{fmtK(r.dps)} dps</span>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

// --- encounter table (per-mob, one row per combatant) ---------------------

function EncounterRow({
  card,
  maxPct,
  open,
  onToggle,
}: {
  card: EncounterCardData;
  maxPct: number;
  open: boolean;
  onToggle: () => void;
}) {
  const d = card.damage;
  return (
    <>
      <div className={`erow ${card.kind} ${card.isSelf ? "is-self" : ""}`} onClick={onToggle}>
        <div className="ebar">
          <div className="fill" style={{ width: `${(card.pct / maxPct) * 100}%` }} />
          <div className="etxt">
            <span className="ename">
              {card.name}
              {card.isSelf && <span className="tag you">you</span>}
            </span>
            <span className="epct">{card.pct}%</span>
          </div>
        </div>
        <span className="enum">{fmtK(d.perSec)}</span>
        <span className="enum heal">{card.healing.total ? fmtK(card.healing.perSec) : "·"}</span>
        <span className="enum tank">{card.taken.total ? fmtK(card.taken.total) : "·"}</span>
      </div>
      {open && (
        <div className="erow-drill">
          <span className="drill-meta">
            {fmt(d.total)} dmg · m {fmt(d.byType.melee)} / s {fmt(d.byType.spell)} / d {fmt(d.byType.dot)} · {d.crits} crit
          </span>
          {d.entries.slice(0, 6).map((e) => (
            <span key={e.name} className="drill-cat">
              {e.damageType !== "unknown" && <span className={`typedot ${e.damageType}`} />}
              {e.name} {fmtK(e.total)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function EncounterTable({
  enc,
  expanded,
  onToggle,
}: {
  enc: EncounterView;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const dps = Math.round(enc.total / Math.max(1, enc.durationSec));
  const maxPct = Math.max(1, ...enc.cards.map((c) => c.pct));
  return (
    <section className={`enc-table ${enc.active ? "live" : ""}`}>
      <div className="enc-th">
        <span className="enc-title">
          {enc.active && <span className="live-dot">⚔</span>} {enc.name}
        </span>
        <span className="muted">
          {enc.durationSec}s · {fmtK(enc.total)} · {fmtK(dps)} dps
        </span>
      </div>
      <div className="etable">
        <div className="erow ehead">
          <span className="muted">% damage</span>
          <span className="enum muted">dps</span>
          <span className="enum muted">hps</span>
          <span className="enum muted">tank</span>
        </div>
        {enc.cards.map((c) => (
          <EncounterRow
            key={c.name}
            card={c}
            maxPct={maxPct}
            open={expanded.has(`${enc.id}:${c.name}`)}
            onToggle={() => onToggle(`${enc.id}:${c.name}`)}
          />
        ))}
      </div>
    </section>
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
