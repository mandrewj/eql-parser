import { useState } from "react";
import type {
  CombatantStats,
  EncounterCard as EncounterCardData,
  EncounterView,
  Filters,
  FightSummary,
  MetricKind,
  MetricStat,
  SelfEncounterPoint,
  StanceBreakdown,
  StanceOverviewRow,
  StanceOverviewWindow,
  StanceState,
} from "./types";
import { metricMeta } from "./filters";

const fmt = (n: number) => n.toLocaleString();
// k-notation past `at`, one decimal — dropped over 100k so narrow columns don't overflow
const scaleK = (n: number, at: number) => (n >= at ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString());
const fmtK = (n: number) => scaleK(n, 10000);
const fmtTank = (n: number) => scaleK(n, 2000); // tanking totals get big fast
const fmtDrill = (n: number) => scaleK(n, 1000); // breakdown lines stay compact
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
const comboKey = (r: { melee: string; invocation: string }) => `${r.melee}|${r.invocation}`;

// Six validated categorical slots (see styles.css); anything past six shares the neutral.
const SLOTS = 6;
const comboColor = (key: string, map: Map<string, number>) => {
  const i = map.get(key);
  return i === undefined || i >= SLOTS ? "var(--s-other)" : `var(--s${i + 1})`;
};

/** Colour follows the combo, not its rank: slots are handed out in the order combos first
 *  appear in the full history, so switching the 10/25/50 window never repaints a bar. */
function buildComboColors(history: SelfEncounterPoint[], rows: StanceOverviewRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = history.length - 1; i >= 0; i--) {
    const k = comboKey(history[i]!);
    if (!map.has(k)) map.set(k, map.size);
  }
  for (const r of rows) if (!map.has(comboKey(r))) map.set(comboKey(r), map.size);
  return map;
}

/** Diverging bars: my DPS above the baseline, damage taken below. The two halves are
 *  separate panels sharing an encounter axis — each is scaled to its own peak (labelled
 *  in the header), so heights are never compared across the baseline. */
function EncounterHistory({
  points,
  colors,
  selected,
  onSelect,
}: {
  points: SelfEncounterPoint[];
  colors: Map<string, number>;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const maxDps = Math.max(1, ...points.map((p) => p.dps));
  const maxTaken = Math.max(1, ...points.map((p) => p.taken));
  const hp = hover === null ? null : points[hover] ?? null;

  const col = (p: SelfEncounterPoint, i: number) => {
    const key = comboKey(p);
    const dimmed = selected !== null && selected !== key;
    return `hcell ${dimmed ? "dim" : ""} ${hover === i ? "hov" : ""}`;
  };
  const bind = (p: SelfEncounterPoint, i: number) => ({
    onMouseEnter: () => setHover(i),
    onClick: () => onSelect(selected === comboKey(p) ? null : comboKey(p)),
    title: `${p.name} · ${fmtDrill(p.dps)} dps · ${fmtDrill(p.taken)} taken`,
  });

  return (
    <div className="hist" onMouseLeave={() => setHover(null)}>
      <div className="hist-head">
        <span className="hist-title">Per encounter · oldest → newest</span>
        {hp ? (
          <span className="hist-readout">
            <span className="hswatch" style={{ background: comboColor(comboKey(hp), colors) }} />
            {hp.name} · {hp.durationSec}s · <b>{fmtDrill(hp.dps)}</b> dps · <b>{fmtDrill(hp.taken)}</b> taken · ⚔{" "}
            {stanceLabel(hp.melee)} · ✦ {stanceLabel(hp.invocation)}
          </span>
        ) : (
          <span className="hist-scale">
            ▲ peak {fmtDrill(maxDps)} dps · ▼ peak {fmtDrill(maxTaken)} taken
          </span>
        )}
      </div>
      <div className="hist-plot">
        <div className="hrow up">
          {points.map((p, i) => (
            <div key={p.id} className={col(p, i)} {...bind(p, i)}>
              <div
                className="hbar"
                style={{ height: `${(p.dps / maxDps) * 100}%`, background: comboColor(comboKey(p), colors) }}
              />
            </div>
          ))}
        </div>
        <div className="hist-base" />
        <div className="hrow down">
          {points.map((p, i) => (
            <div key={p.id} className={col(p, i)} {...bind(p, i)}>
              <div
                className="hbar tank"
                style={{ height: `${(p.taken / maxTaken) * 100}%`, background: comboColor(comboKey(p), colors) }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StanceOverview({
  windows,
  history,
  stance,
}: {
  windows: StanceOverviewWindow[];
  history: SelfEncounterPoint[];
  stance: StanceState | null;
}) {
  const [n, setN] = useState(25);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = windows.find((w) => w.n === n)?.rows ?? [];
  const totalDmg = rows.reduce((s, r) => s + r.damage, 0);
  const totalSec = rows.reduce((s, r) => s + r.seconds, 0);
  const overall = Math.round(totalDmg / Math.max(1, totalSec));
  const colors = buildComboColors(history, rows);
  const points = history.slice(0, n).reverse(); // history is newest-first; the chart reads left→right
  const isCurrent = (r: { melee: string; invocation: string }) =>
    stance != null && r.melee === stance.melee && r.invocation === stance.invocation;

  // How the combo I'm standing in right now compares with the window's best.
  const best = rows[0] ?? null;
  const cur = rows.find(isCurrent) ?? null;
  const gap = best && cur && best.dps > 0 ? Math.round(((cur.dps - best.dps) / best.dps) * 100) : null;
  return (
    <section className="overview">
      <div className="ov-head">
        <span className="ov-title">My DPS · by stance</span>
        <div className="ov-windows">
          {windows.map((w) => (
            <button key={w.n} className={w.n === n ? "wchip on" : "wchip"} onClick={() => setN(w.n)}>
              {w.n}
            </button>
          ))}
        </div>
        {rows.length > 0 &&
          (gap === null ? (
            <span className="ov-delta none">current combo · no data in window</span>
          ) : gap >= 0 ? (
            <span className="ov-delta good">current combo · best of {rows.length}</span>
          ) : (
            <span className="ov-delta bad">
              current combo <b>−{Math.abs(gap)}%</b> vs best ({fmtK(best!.dps)} dps)
            </span>
          ))}
        <span className="ov-overall">
          {fmtK(overall)} <span className="munit">avg dps</span>
        </span>
      </div>
      {rows.length === 0 && <div className="muted small">No encounters yet.</div>}
      <div className="ov-tiles">
        {rows.map((r) => {
          const key = comboKey(r);
          const dimmed = selected !== null && selected !== key;
          return (
            <div
              key={key}
              className={`ov-tile ${isCurrent(r) ? "current" : ""} ${selected === key ? "sel" : ""} ${dimmed ? "dim" : ""}`}
              onClick={() => setSelected(selected === key ? null : key)}
              title={
                `${fmt(r.dps)} dps · ${fmt(r.takenPerSec)}/sec taken · ${r.timeShare}% of the window's combat time ` +
                `(${r.seconds}s) — click to ${selected === key ? "clear the highlight" : "highlight this combo below"}`
              }
            >
              <span className="ov-tile-dps">
                <span className="ov-swatch" style={{ background: comboColor(key, colors) }} />
                {fmtK(r.dps)} <span className="munit">dps</span>
                {isCurrent(r) && <span className="ov-now">now</span>}
              </span>
              <span className="ov-tile-sub">
                🛡 {r.taken > 0 && r.takenPerSec === 0 ? "<1" : fmtDrill(r.takenPerSec)}
                <span className="munit">/s</span> · ⏱ {r.timeShare}
                <span className="munit">%</span>
              </span>
              <span className="ov-tile-combo">
                ⚔ {stanceLabel(r.melee)} · ✦ {stanceLabel(r.invocation)}
              </span>
            </div>
          );
        })}
      </div>
      <EncounterHistory points={points} colors={colors} selected={selected} onSelect={setSelected} />
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
        <span className="enum tank">{card.taken.total ? fmtTank(card.taken.total) : "·"}</span>
      </div>
      {open && (
        <div className={`erow-drill ${card.isSelf ? "is-self" : ""}`}>
          <span className="drill-meta">
            {fmtDrill(d.total)} dmg · m {fmtDrill(d.byType.melee)} / s {fmtDrill(d.byType.spell)} / d {fmtDrill(d.byType.dot)} · {d.crits} crit
          </span>
          {d.entries.slice(0, 6).map((e) => (
            <span key={e.name} className="drill-cat">
              {e.damageType !== "unknown" && <span className={`typedot ${e.damageType}`} />}
              {e.name} {fmtDrill(e.total)}
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
            // my own breakdown stays open in every encounter; others toggle
            open={c.isSelf || expanded.has(`${enc.id}:${c.name}`)}
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
