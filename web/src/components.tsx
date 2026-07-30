import { useState } from "react";
import type {
  CombatantStats,
  DeathReport,
  LongTermStats,
  MilestoneSpan,
  EncounterCard as EncounterCardData,
  EncounterView,
  Filters,
  FightSummary,
  MetricKind,
  MetricStat,
  Milestone,
  MilestoneKind,
  ProgressState,
  ProgressWindow,
  SelfEncounterPoint,
  StanceBreakdown,
  StanceOverviewRow,
  StanceOverviewWindow,
  StanceState,
} from "./types";
import { metricMeta } from "./filters";
import { fmt, fmtDrill, fmtK, fmtTank, plural, span, time } from "./format";
import { isPartialWindow, weightedAvgDps } from "./stats";

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
 *  appear in the full history, so switching the 10/25/50 window never repaints a bar.
 *  Exported so the encounter timelines colour by the *same* map as the My DPS chart — a
 *  combo has to mean one colour everywhere or the swatches stop being a legend. */
export function buildComboColors(
  history: SelfEncounterPoint[],
  rows: StanceOverviewRow[],
  /** Combos seen bucket-by-bucket inside encounter timelines. A timeline resolves the combo
   *  per *bucket*, so it routinely contains one that is neither any encounter's dominant
   *  combo nor a row in the overview — on a real boss fight that left 20 of 74 buckets on
   *  the neutral fallback, which defeats the point of colouring by stance. Added last so the
   *  slots the two charts already agreed on never shift. */
  timelineCombos: readonly string[] = [],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = history.length - 1; i >= 0; i--) {
    const k = comboKey(history[i]!);
    if (!map.has(k)) map.set(k, map.size);
  }
  for (const r of rows) if (!map.has(comboKey(r))) map.set(comboKey(r), map.size);
  for (const k of timelineCombos) if (k && !map.has(k)) map.set(k, map.size);
  return map;
}

// A glyph on the rail means "this kind is marked on the timeline" — the progression strip
// below the chart reuses the same shapes, so it doubles as the legend. Shape carries the
// identity; colour only reinforces it (the rail is too small for colour to stand alone).
const MS_GLYPH: Record<MilestoneKind, string> = {
  level: "▲",
  ap: "◆",
  ability: "★",
  death: "✕",
  zone: "»",
};
// Only the two that explain a step change in the bars get a full-height guide.
const MS_GUIDE: MilestoneKind[] = ["level", "death"];

/** Which encounter slot a timestamp belongs to: the first encounter that ended at or
 *  after it. Markers draw on that slot's *left edge*, so a level-up earned on a kill
 *  lands exactly on the boundary between the two encounters. */
function markerSlot(tsMs: number, points: SelfEncounterPoint[]): number {
  const i = points.findIndex((p) => p.endMs >= tsMs);
  return i === -1 ? points.length : i;
}

/** Keep a marker sitting on the very first/last boundary from hanging off the plot. */
const markerShift = (x: number) => (x <= 0.001 ? "0%" : x >= 0.999 ? "-100%" : "-50%");

/** Collapse one boundary's milestones to one mark per kind, carrying a count. Four zone
 *  changes in the same gap are one `»4`, not four glyphs competing for ~14px of rail. */
function clusterByKind(items: Milestone[]): Array<{ mark: Milestone; count: number }> {
  const byKind = new Map<MilestoneKind, Milestone[]>();
  for (const m of items) {
    const at = byKind.get(m.kind);
    if (at) at.push(m);
    else byKind.set(m.kind, [m]);
  }
  return [...byKind.values()].map((group) => {
    const last = group[group.length - 1]!;
    if (group.length === 1) return { mark: last, count: 1 };
    // Hovering the cluster should name everything in it, newest last.
    return { mark: { ...last, detail: group.map((g) => g.label).join(" · ") }, count: group.length };
  });
}

/** Diverging bars: my DPS above the baseline, damage taken below. Both halves are rates
 *  over each encounter's own length, so a long fight doesn't tower over a short one just
 *  for lasting. They stay separate panels sharing an encounter axis — each scaled to its
 *  own peak (labelled in the header), so heights are never compared across the baseline.
 *  Between them runs a milestone rail: levels, ability points, AAs, deaths and zone
 *  changes, placed at the encounter boundary they happened on. */
function EncounterHistory({
  points,
  colors,
  selected,
  onSelect,
  milestones,
}: {
  points: SelfEncounterPoint[];
  colors: Map<string, number>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  milestones: Milestone[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [hoverMs, setHoverMs] = useState<Milestone | null>(null);
  if (points.length === 0) return null;

  const maxDps = Math.max(1, ...points.map((p) => p.dps));
  const maxTaken = Math.max(1, ...points.map((p) => p.takenPerSec));
  const hp = hover === null ? null : points[hover] ?? null;
  const from = points[0]!.startMs;
  const elapsed = points[points.length - 1]!.endMs - from;

  // Computed from the very array being drawn, so the line can't drift from its bars.
  const avgDps = weightedAvgDps(points);
  const totalDmg = points.reduce((s, p) => s + p.damage, 0);
  const totalSec = points.reduce((s, p) => s + p.durationSec, 0);

  // Resolve each point's combo identity and readout once — both halves of the chart draw
  // from this, so neither is built twice per render.
  const marks = points.map((p) => ({
    p,
    key: comboKey(p),
    color: comboColor(comboKey(p), colors),
    title:
      `${p.name} · ${p.durationSec}s — ${fmtDrill(p.dps)} dps (${fmt(p.damage)} damage), ` +
      `${fmtDrill(p.takenPerSec)}/s taken (${fmt(p.taken)}); both over the encounter's own length`,
  }));

  // Milestones inside the plotted span, bucketed onto the boundary they fall on so
  // several in the same gap (ding → ability point → new AA) render as one cluster.
  const bySlot = new Map<number, Milestone[]>();
  for (const m of milestones) {
    if (m.tsMs < from) continue;
    const slot = markerSlot(m.tsMs, points);
    const at = bySlot.get(slot);
    if (at) at.push(m);
    else bySlot.set(slot, [m]);
  }
  const groups = [...bySlot.entries()].map(([slot, items]) => ({ slot, x: slot / points.length, items }));
  const guides = groups.flatMap(({ x, items }) =>
    items.filter((m) => MS_GUIDE.includes(m.kind)).map((m) => ({ m, x })),
  );

  /** One half of the diverging pair, scaled to its own peak. */
  const half = (cls: "up" | "down", value: (p: SelfEncounterPoint) => number, max: number) => (
    <div className={`hrow ${cls}`}>
      {marks.map(({ p, key, color, title }, i) => (
        <div
          key={p.id}
          className={`hcell ${selected !== null && selected !== key ? "dim" : ""} ${hover === i ? "hov" : ""}`}
          onMouseEnter={() => setHover(i)}
          onClick={() => onSelect(selected === key ? null : key)}
          title={title}
        >
          <div
            className={`hbar ${cls === "down" ? "tank" : ""} ${value(p) === max ? "peak" : ""}`}
            style={{ height: `${(value(p) / max) * 100}%`, backgroundColor: color }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="hist"
      onMouseLeave={() => {
        setHover(null);
        setHoverMs(null);
      }}
    >
      <div className="hist-head">
        {/* The window is too narrow to spell the axis direction out next to the span. */}
        <span className="hist-title" title="Oldest on the left, newest on the right">
          Per encounter · {points.length} over {span(elapsed)}
        </span>
        {hoverMs ? (
          <span className="hist-readout">
            <span className={`hswatch ms ${hoverMs.kind}`}>{MS_GLYPH[hoverMs.kind]}</span>
            <b>{hoverMs.detail}</b> · {time(hoverMs.tsMs)}
          </span>
        ) : hp ? (
          <span className="hist-readout">
            <span className="hswatch" style={{ background: comboColor(comboKey(hp), colors) }} />
            {hp.name} · {hp.durationSec}s · <b>{fmtDrill(hp.dps)}</b> dps · <b>{fmtDrill(hp.takenPerSec)}</b>/s taken · ⚔{" "}
            {stanceLabel(hp.melee)} · ✦ {stanceLabel(hp.invocation)}
          </span>
        ) : (
          <span className="hist-scale">
            ▲ peak {fmtDrill(maxDps)} dps · ▼ peak {fmtDrill(maxTaken)}/s taken
          </span>
        )}
      </div>
      <div className="hist-plot">
        <div className="hist-guides">
          {guides.map(({ m, x }) => (
            <span
              key={m.id}
              className={`hguide ${m.kind} ${hoverMs?.id === m.id ? "on" : ""}`}
              style={{ left: `${x * 100}%` }}
            />
          ))}
        </div>
        <div className="hist-up">
          {half("up", (p) => p.dps, maxDps)}
          {/* Where these bars actually average out, weighted by how long each fight lasted. */}
          {avgDps > 0 && (
            <div
              className="hist-avg"
              style={{ bottom: `${Math.min(100, (avgDps / maxDps) * 100)}%` }}
              title={
                `${fmt(avgDps)} dps: ${fmt(totalDmg)} damage over ${fmt(totalSec)}s of encounters, ` +
                `weighted by each one's length. Runs below the panel's overall figure when mobs overlap — ` +
                `seconds shared by two fights count once on the clock but in both encounters.`
              }
            >
              <span className="hist-avg-tag">avg {fmtDrill(avgDps)}</span>
            </div>
          )}
        </div>
        <div className={`hist-rail ${groups.length ? "" : "bare"}`}>
          {groups.map(({ slot, x, items }) => (
            <span key={slot} className="hgroup" style={{ left: `${x * 100}%`, transform: `translateX(${markerShift(x)})` }}>
              {clusterByKind(items).map(({ mark, count }) => (
                <span
                  key={mark.kind}
                  className={`hms ${mark.kind}`}
                  title={`${mark.detail} · ${time(mark.tsMs)}`}
                  onMouseEnter={() => setHoverMs(mark)}
                  onMouseLeave={() => setHoverMs(null)}
                >
                  {MS_GLYPH[mark.kind]}
                  {count > 1 && <span className="hms-n">{count}</span>}
                </span>
              ))}
            </span>
          ))}
        </div>
        {half("down", (p) => p.takenPerSec, maxTaken)}
      </div>
    </div>
  );
}

/** What the window bought me, in the same glyphs the rail uses — so it reads as the
 *  rail's legend as well as a scoreboard. Skill-ups and xp have no glyph on purpose:
 *  they're far too frequent to mark, so they stay plain text. */
function ProgressStrip({ w, now }: { w: ProgressWindow | undefined; now: ProgressState }) {
  const standing = [
    now.level === null ? null : `Lv ${now.level}`,
    now.aaUnspent === null ? null : `${now.aaUnspent} AA unspent`,
  ].filter(Boolean);
  const marks: Array<{ kind: MilestoneKind; text: string }> = [];
  if (w) {
    if (w.levels) marks.push({ kind: "level", text: plural(w.levels, "level") });
    if (w.aaGained) marks.push({ kind: "ap", text: `+${w.aaGained} AA` });
    if (w.abilities) marks.push({ kind: "ability", text: plural(w.abilities, "ability", "abilities") });
    if (w.deaths) marks.push({ kind: "death", text: plural(w.deaths, "death") });
  }
  const tail = [
    w?.skillUps ? plural(w.skillUps, "skill-up") : null,
    w?.xpPct ? `+${w.xpPct}% xp` : null,
  ].filter(Boolean);
  if (standing.length === 0 && marks.length === 0 && tail.length === 0) return null;

  return (
    <div className="prog">
      {standing.length > 0 && <span className="prog-now">{standing.join(" · ")}</span>}
      {marks.map((m) => (
        <span key={m.kind} className={`pstat ${m.kind}`}>
          <span className="pglyph">{MS_GLYPH[m.kind]}</span>
          {m.text}
        </span>
      ))}
      {tail.length > 0 && <span className="pstat muted">{tail.join(" · ")}</span>}
    </div>
  );
}

export function StanceOverview({
  windows,
  history,
  stance,
  milestones,
  progressWindows,
  progress,
}: {
  windows: StanceOverviewWindow[];
  history: SelfEncounterPoint[];
  stance: StanceState | null;
  milestones: Milestone[];
  progressWindows: ProgressWindow[];
  progress: ProgressState;
}) {
  const [n, setN] = useState(25);
  const [selected, setSelected] = useState<string | null>(null);
  const { rows = [], damage = 0, seconds = 0 } = windows.find((w) => w.n === n) ?? {};
  // Damage per second of combat: the window's own totals, not a mean of the tiles' rates
  // and not a re-sum of `rows` (which omits combos I spent time in without dealing damage).
  const overall = Math.round(damage / Math.max(1, seconds));
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
        <span
          className="ov-overall"
          title={
            `${fmt(overall)} dps — ${fmt(damage)} damage over ${fmt(seconds)}s of combat ` +
            `across the last ${n} encounters. Wall-clock seconds, counted once even when two mobs are up, ` +
            `so this sits above the chart's per-encounter average whenever fights overlap.`
          }
        >
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
      <EncounterHistory
        points={points}
        colors={colors}
        selected={selected}
        onSelect={setSelected}
        milestones={milestones}
      />
      <ProgressStrip w={progressWindows.find((p) => p.n === n)} now={progress} />
    </section>
  );
}

// --- stat tabs ------------------------------------------------------------

/** How many completed AA stretches the engine sends. */
const AA_SHOWN = 4;

const hhmm = (sec: number) => {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** The long-term stats, as one container with a tab strip rather than a stack of boxes.
 *
 *  Four collapsed boxes cost four rows of a 540px panel to say nothing — vertical space is the
 *  scarce resource here, and these are all things you consult occasionally rather than watch.
 *  As tabs the closed state is a single row, and only the selected panel is ever mounted.
 *  Clicking the open tab closes it, so "all closed" stays reachable in one click. */
export function StatTabs({ stats, deaths }: { stats: LongTermStats; deaths: DeathReport[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const { levels, aa, zoneStance } = stats;

  const spanRow = (r: MilestoneSpan, i: number) => (
    <div key={`${r.label}-${r.tsMs ?? i}`} className={`lt-row ${r.open ? "open" : ""}`}>
      <span className="lt-since">
        {r.label}
        {/* AA labels are all "+2 AA" and only the clock tells them apart. */}
        {r.tsMs !== null && <span className="lt-when"> {time(r.tsMs)}</span>}
      </span>
      <span className="lt-fig">
        {fmt(r.kills)} <span className="lt-unit">kills</span>
      </span>
      <span className="lt-fig">
        {fmt(r.zones)} <span className="lt-unit">zones</span>
      </span>
      <span className="lt-fig">
        {hhmm(r.combatSec)} <span className="lt-unit">in combat</span>
      </span>
    </div>
  );

  const stanceList = (rows: Array<{ stance: string; seconds: number }>, total: number) =>
    rows.length === 0 ? (
      <span className="muted small">nothing recorded yet</span>
    ) : (
      rows.map((r) => (
        <span key={r.stance} className="lt-stance">
          <span className="lt-stance-name">{stanceLabel(r.stance)}</span> {hhmm(r.seconds)}
          <span className="lt-stance-pct">{total > 0 ? ` · ${Math.round((r.seconds / total) * 100)}%` : ""}</span>
        </span>
      ))
    );
  const meleeTotal = zoneStance.melee.reduce((n, r) => n + r.seconds, 0);
  const invTotal = zoneStance.invocation.reduce((n, r) => n + r.seconds, 0);

  // A tab earns its place by carrying a figure, not just a noun — the strip is on screen
  // permanently, so each label should be worth reading without opening anything.
  const tabs: Array<{ key: string; label: string; note?: string; accent?: string; body: React.ReactNode }> = [
    {
      key: "levels",
      label: "Levels",
      note: levels[0] ? hhmm(levels[0].combatSec) : undefined,
      body: (
        <>
          {levels.length === 0 ? (
            <div className="muted small">No levels yet this session.</div>
          ) : (
            levels.map(spanRow)
          )}
          <div className="lt-note muted small">
            The top row is still running; each one below is what that level cost, from the level
            before it.
          </div>
        </>
      ),
    },
    {
      key: "aa",
      label: "AA",
      note: aa[0] ? hhmm(aa[0].combatSec) : undefined,
      body: (
        <>
          {aa.length === 0 ? (
            <div className="muted small">No Alternate Advancement earned yet this session.</div>
          ) : (
            aa.map(spanRow)
          )}
          <div className="lt-note muted small">
            Alternate Advancement — the last {AA_SHOWN} earned, newest first.
          </div>
        </>
      ),
    },
    {
      key: "stances",
      label: "Stances",
      note: meleeTotal > 0 ? hhmm(meleeTotal) : undefined,
      body: (
        <>
          <div className="lt-row stances">
            <span className="lt-since">⚔ melee</span>
            {stanceList(zoneStance.melee, meleeTotal)}
          </div>
          <div className="lt-row stances">
            <span className="lt-since">✦ invocation</span>
            {stanceList(zoneStance.invocation, invTotal)}
          </div>
          <div className="lt-note muted small">
            Since you last entered {zoneStance.zone ?? "this zone"} — wall-clock, so time spent
            standing in a stance between pulls counts too.
          </div>
        </>
      ),
    },
  ];
  // Deaths only earn a tab once there are some.
  if (deaths.length > 0) {
    tabs.push({
      key: "deaths",
      label: "Deaths",
      note: String(deaths.length),
      accent: "deaths",
      body: (
        <>
          {deaths.map((d) => (
            <DeathRow key={d.id} d={d} />
          ))}
        </>
      ),
    });
  }

  const active = tabs.find((t) => t.key === open);
  return (
    <section className={`stats ${active ? "open" : ""} ${active?.accent ?? ""}`}>
      <div className="stat-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={open === t.key}
            className={`stat-tab ${open === t.key ? "on" : ""} ${t.accent ?? ""}`}
            onClick={() => setOpen(open === t.key ? null : t.key)}
          >
            {t.label}
            {t.note && <span className="stat-note">{t.note}</span>}
          </button>
        ))}
      </div>
      {active && <div className="stat-body">{active.body}</div>}
    </section>
  );
}

// --- what killed me -------------------------------------------------------

/** A death, read backwards. The question is never "how much did I take" — it is *what* was
 *  hitting me and whether anyone was healing, so the two breakdown lines (by ability, by
 *  attacker) carry the answer and the totals are context.
 *
 *  Dying to one thing and dying to six look nothing alike here, which is the point: on a real
 *  death the attacker line read "a festering hag 749 · a skeletal monk 162 · a greater dark
 *  bone 150 · a barbed bone skeleton 106 · a dusty werebat 63" — that is an add problem, not a
 *  tanking one, and no single number says so. */
function DeathRow({ d }: { d: DeathReport }) {
  const last = d.blows[d.blows.length - 1];
  return (
    <div className="death">
      <div className="death-th">
        <span className="death-x">✕</span>
        <span className="death-killer">{d.killer}</span>
        {last && (
          <span className="death-blow" title={`The last hit to land before the death line`}>
            → {last.ability} {fmtDrill(last.amount)}
          </span>
        )}
        <span
          className="death-tot"
          title={
            `${fmt(d.totalTaken)} damage taken in the ${d.windowSec}s before dying, and ` +
            `${fmt(d.healed)} healing received in the same window. The window is fixed because ` +
            `the log never states hit points, so there is no way to know when the trouble began.`
          }
        >
          {fmtK(d.totalTaken)} in {d.windowSec}s
          {d.healed > 0 ? <span className="death-heal"> · +{fmtK(d.healed)} healed</span> : <span className="death-noheal"> · no heals</span>}
        </span>
      </div>
      <div className="death-line">
        {d.byAbility.slice(0, 4).map((a) => (
          <span key={a.name} className="drill-cat">
            {a.damageType !== "unknown" && <span className={`typedot ${a.damageType}`} />}
            {a.name} {fmtDrill(a.total)}
          </span>
        ))}
      </div>
      <div className="death-line who">
        {d.byAttacker.slice(0, 4).map((a) => (
          <span key={a.name} className="drill-cat">
            {a.name} {fmtDrill(a.total)}
          </span>
        ))}
        {d.byAttacker.length > 4 && <span className="drill-cat more">+{d.byAttacker.length - 4} more</span>}
        <span className="death-stance" title={`The stance combo I was in when I died`}>
          ✕ {stanceLabel(d.melee)} · ✦ {stanceLabel(d.invocation)}
        </span>
      </div>
    </div>
  );
}

// --- encounter table (per-mob, one row per combatant) ---------------------

function EncounterRow({
  card,
  maxPct,
  encSec,
  open,
  onToggle,
}: {
  card: EncounterCardData;
  maxPct: number;
  /** The encounter's own length, for reading a row's engaged time against. */
  encSec: number;
  open: boolean;
  onToggle: () => void;
}) {
  const d = card.damage;
  const late = encSec - card.activeSec;
  const partial = isPartialWindow(card.activeSec, encSec);
  return (
    <>
      <div className={`erow ${card.kind} ${card.isSelf ? "is-self" : ""}`} onClick={onToggle}>
        <div className="ebar">
          <div className="fill" style={{ width: `${(card.pct / maxPct) * 100}%` }} />
          <div className="etxt">
            <span className="ename">
              {/* A charmed mob fights for us under its own name, which reads exactly like
                  the enemy it was a moment ago — the glyph is what tells them apart. */}
              {card.kind === "pet" && (
                <span
                  className="charm"
                  title={
                    `${card.name} is charmed` +
                    (card.ownerName ? ` by ${card.ownerName}` : "") +
                    " — its damage counts for our side while the charm holds."
                  }
                >
                  ⛓
                </span>
              )}
              {card.name}
              {card.isSelf && <span className="tag you">you</span>}
              {card.ownerName && (
                <span
                  className={`tag owner ${card.ownerGuess ? "guess" : ""}`}
                  title={
                    card.ownerGuess
                      ? `Best guess: ${card.ownerName}. Several of the casting class were in this ` +
                        `fight, so the charm's landing message narrows it to a class but not a person — ` +
                        `this is the one seen casting charms most often.`
                      : `Charmed by ${card.ownerName}.`
                  }
                >
                  {card.ownerName}
                  {card.ownerGuess && "?"}
                </span>
              )}
              {/* Same name on both sides of the fight: the log cannot say which of the two
                  swung, so the figures are the pair's whole exchange. Marked rather than
                  hidden — the pet is a real participant and this is its true upper bound. */}
              {card.ambiguous && (
                <span
                  className="tag approx"
                  title={
                    `${card.name} is charmed and fighting another mob of the same name. The log ` +
                    `gives both the same name, so this row is the whole exchange between them — ` +
                    `an upper bound on the charmed one's damage, not its output alone.`
                  }
                >
                  ~
                </span>
              )}
            </span>
            <span className="epct">{card.pct}%</span>
          </div>
        </div>
        <span className="enum">{fmtK(d.perSec)}</span>
        <span className="enum heal">{card.healing.total ? fmtK(card.healing.perSec) : "·"}</span>
        <span className="enum tank">{card.taken.total ? fmtTank(card.taken.total) : "·"}</span>
        <span
          className={`enum time ${partial ? "part" : ""}`}
          title={
            `${card.name} was engaged for ${card.activeSec}s of the ${encSec}s encounter` +
            (late > 0 ? `, joining ${late}s in` : " — there from the start") +
            ". Their dps, hps and tank figures all divide by that window, not the encounter's."
          }
        >
          {card.activeSec}s
        </span>
      </div>
      {open && (
        <>
          {/* Two rows, because they answer different questions and used to compete for one
              line: what *kind* of damage this was, then which abilities delivered it. The
              broad row is the one that stays comparable between rows and between fights. */}
          <div className={`erow-drill totals ${card.isSelf ? "is-self" : ""}`}>
            <span className="dtot">{fmtDrill(d.total)} dmg</span>
            {(["melee", "spell", "dot"] as const).map((t) => (
              <span key={t} className={`dcat ${d.byType[t] ? "" : "nil"}`}>
                <span className={`typedot ${t}`} />
                {t === "dot" ? "dot" : t} {fmtDrill(d.byType[t])}
              </span>
            ))}
            {d.crits > 0 && <span className="dcrit">{d.crits} crit</span>}
          </div>
          <div className={`erow-drill abilities ${card.isSelf ? "is-self" : ""}`}>
            {d.entries.slice(0, 4).map((e) => (
              <span key={e.name} className="drill-cat">
                {e.damageType !== "unknown" && <span className={`typedot ${e.damageType}`} />}
                {e.name} {fmtDrill(e.total)}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** The encounter's own timeline: a band of its own, full card width, above the table.
 *
 *  Same grammar as the My DPS chart at a different scale: my damage above the baseline, what
 *  the mob dealt me below it, each half normalised to its own peak so neither flattens the
 *  other (they routinely differ by an order of magnitude). Colour is the stance combo I was
 *  in for that bucket, from the same map the My DPS panel uses, so a combo means one colour
 *  everywhere and a mid-fight stance change reads as a change of colour.
 *
 *  It briefly overlapped the table, to "fill the card" literally. That was wrong: bars
 *  running across every number made the table hard to read, which is the opposite of what a
 *  chart beside a table is for. Separated, it can also run at full strength rather than
 *  hiding at 19% opacity to stay out of the way of the text.
 *
 *  Hidden when there is nothing to show — a fight too short to have a shape, or one where I
 *  neither dealt nor took anything. */
function EncounterTimeline({ enc, colors }: { enc: EncounterView; colors: Map<string, number> }) {
  const dealt = enc.selfSpark ?? [];
  const taken = enc.selfTakenSpark ?? [];
  const combos = enc.sparkCombos ?? [];
  const n = Math.max(dealt.length, taken.length);
  const upPeak = Math.max(0, ...dealt);
  const downPeak = Math.max(0, ...taken);
  if (n < 4 || (upPeak === 0 && downPeak === 0)) return null;

  const bucketSec = enc.sparkBucketSec;
  return (
    <div
      className="enc-timeline"
      title={
        `This encounter, ${plural(bucketSec, "second")} per bar. Above the line my damage ` +
        `(peak ${fmtDrill(upPeak)} dps), below it what ${enc.name} dealt me ` +
        `(peak ${fmtDrill(downPeak)}/s). Each half is scaled to its own peak, so heights are ` +
        `never compared across the line. Colour is the stance combo I was in.`
      }
    >
      {Array.from({ length: n }, (_, i) => {
        const up = dealt[i] ?? 0;
        const down = taken[i] ?? 0;
        const color = comboColor(combos[i] ?? "", colors);
        return (
          <div key={i} className="tl-col">
            <div className="tl-half up">
              <div
                className="tl-bar"
                style={{ height: upPeak ? `${(up / upPeak) * 100}%` : 0, background: color }}
              />
            </div>
            <div className="tl-half down">
              <div
                className="tl-bar taken"
                style={{ height: downPeak ? `${(down / downPeak) * 100}%` : 0 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EncounterTable({
  enc,
  expanded,
  onToggle,
  showHead = true,
  colors,
}: {
  enc: EncounterView;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  /** Column labels only earn their row once per section — the grid keeps every
   *  table's columns aligned whether or not this one prints them. */
  showHead?: boolean;
  /** Combo → colour slot, shared with the My DPS chart so a stance means one colour. */
  colors: Map<string, number>;
}) {
  const maxPct = Math.max(1, ...enc.cards.map((c) => c.pct));
  // Both header figures cover the whole encounter, unlike the per-person rows below.
  const out = enc.npcDamage;
  return (
    <section className={`enc-table ${enc.active ? "live" : ""}`}>
      <div className="enc-th">
        <span className="enc-title">
          {enc.active && <span className="live-dot">⚔</span>} {enc.name}
        </span>
        {out.total > 0 && (
          <span
            className="enc-out"
            title={`${enc.name} dealt ${fmt(out.total)} to everyone it fought — ${fmt(out.perSec)} dps over the ${enc.durationSec}s encounter`}
          >
            → {fmtK(out.perSec)} dps
          </span>
        )}
        <span
          className="enc-tot"
          title={`Whole encounter: ${fmt(enc.total)} damage dealt to ${enc.name} over ${enc.durationSec}s, ${fmt(enc.dps)} dps from everyone combined. The rows below are per-person, each over their own active window.`}
        >
          <span className="enc-scope">encounter</span> {enc.durationSec}s · {fmtK(enc.total)} dmg · {fmtK(enc.dps)} dps
        </span>
      </div>
      <EncounterTimeline enc={enc} colors={colors} />
      <div className="etable">
        {showHead && (
          <div className="erow ehead">
            <span className="muted">% damage</span>
            <span className="enum muted">dps</span>
            <span className="enum muted">hps</span>
            <span className="enum muted">tank</span>
            <span className="enum muted" title="Seconds each character was engaged with this mob">
              time
            </span>
          </div>
        )}
        {enc.cards.map((c) => (
          <EncounterRow
            key={c.name}
            card={c}
            maxPct={maxPct}
            encSec={enc.durationSec}
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
