// Frontend mirror of the server's view types (see ../../src/types.ts).

export type EntityKind = "self" | "player" | "pet" | "npc" | "unknown";
export type DamageType = "melee" | "spell" | "dot" | "unknown";

export type MetricKind = "damage" | "healing" | "taken";

export interface AbilityBreakdown {
  name: string;
  damageType: DamageType;
  total: number;
  hits: number;
  crits: number;
}

export interface MetricStat {
  total: number;
  perSec: number; // DPS for damage/taken, HPS for healing
  hits: number;
  crits: number;
  avoided: number;
  byType: Record<DamageType, number>;
  entries: AbilityBreakdown[];
}

export interface StanceBreakdown {
  stance: string;
  total: number;
  dps: number;
  activeSeconds: number;
}

export interface StanceBreakdowns {
  melee: StanceBreakdown[];
  invocation: StanceBreakdown[];
}

export interface StanceState {
  melee: string;
  invocation: string;
}

export interface StanceOverviewRow {
  melee: string;
  invocation: string;
  damage: number;
  taken: number; // damage taken while in this combo — the defensive cost of the DPS
  seconds: number;
  dps: number;
  takenPerSec: number;
  timeShare: number; // percent of the window's combat time spent in this combo
}

/** The last `n` finished encounters, split by stance combo. Window totals are taken before
 *  zero-damage combos are dropped from `rows`, so the headline rate is divided by every
 *  combat second. Those seconds are *merged* wall-clock: two mobs at once cost one second. */
export interface StanceOverviewWindow {
  n: number; // number of most-recent encounters averaged
  rows: StanceOverviewRow[]; // combos I dealt damage in, best DPS first
  damage: number; // my damage over the window…
  seconds: number; // …and the combat seconds behind it
}

/** A dated, one-off event marked on the encounter timeline. */
export type MilestoneKind = "level" | "ap" | "ability" | "death" | "zone";

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  tsMs: number;
  label: string;
  detail: string;
  value?: number;
}

/** Progression totals over the same encounter window the chart plots. */
export interface ProgressWindow {
  n: number;
  levels: number;
  aaGained: number;
  abilities: number;
  skillUps: number;
  xpPct: number;
  deaths: number;
}

export interface ProgressState {
  level: number | null;
  aaUnspent: number | null;
}

/** One finished encounter, from my point of view — the history chart's data point.
 *  Both rates are normalised by the encounter's length, not by my active window inside
 *  it, so bars are comparable and their duration-weighted mean is a real average. */
export interface SelfEncounterPoint {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  durationSec: number;
  damage: number; // my total damage
  dps: number; // damage ÷ durationSec
  taken: number; // total damage I took
  takenPerSec: number; // taken ÷ durationSec
  melee: string; // stance combo I spent the most time in during this encounter
  invocation: string;
}

/** One incoming hit in the run-up to a death. */
export interface DeathBlow {
  tsMs: number;
  attacker: string;
  ability: string;
  amount: number;
  damageType: DamageType;
  crit: boolean;
}

/** What killed me — assembled at the moment of death from a rolling window of incoming hits.
 *  The window is fixed because the log never states hit points, so "since I was last at full"
 *  is unknowable. */
export interface DeathReport {
  id: string;
  tsMs: number;
  killer: string;
  windowSec: number;
  totalTaken: number;
  healed: number;
  blows: DeathBlow[]; // chronological; the last is the killing blow
  byAttacker: Array<{ name: string; total: number }>;
  byAbility: Array<{ name: string; total: number; damageType: DamageType }>;
  melee: string;
  invocation: string;
}

/** One stretch between two milestones — or the open one since the newest. `label` names what
 *  *ended* the stretch, so a completed row reads as "this is what that level cost". */
export interface MilestoneSpan {
  label: string;
  tsMs: number | null;
  kills: number;
  zones: number;
  combatSec: number;
  zone?: string | null; // where I was standing when the milestone landed
  open?: boolean;
}

export interface ZoneStance {
  zone: string | null;
  sinceMs: number | null;
  melee: Array<{ stance: string; seconds: number }>;
  invocation: Array<{ stance: string; seconds: number }>;
}

export interface LongTermStats {
  levels: MilestoneSpan[]; // newest first: the open stretch, then the last 2 levels
  aa: MilestoneSpan[]; // newest first: the open stretch, then the last 4 ability points
  zoneStance: ZoneStance;
}


export interface MoteTierStat {
  tier: string;
  label: string;
  total: number;
  lastMs: number | null;
  lastFrom: string | null;
  /** Mean gap over the last 10 drops of this tier; null until there are enough to mean anything. */
  avgGapSec: number | null;
  samples: number;
}

export interface MoteLoot {
  tier: string;
  label: string;
  tsMs: number;
  from: string;
  zone: string | null;
  difficulty: number | null;
}

export interface MoteStats {
  tiers: MoteTierStat[];
  grid: number[][]; // [tier][difficulty] over the last 250 loots
  perDifficulty: number[];
  unknownZone: number;
  windowSize: number;
  recent: MoteLoot[]; // newest first
}

// --- Plane of Sky -------------------------------------------------------------
// The catalogue is immutable and arrives once from `/api/sky-quests`; only the have-state
// rides the snapshot. Mirrored from `src/types.ts` + `src/parser/sky-catalogue.ts` by hand,
// like every other type here — `web/` imports nothing from `src/`.

export interface SkyQuestItem {
  name: string;
  island: string | null;
  dropsFrom: string | null;
}

export interface SkyQuest {
  quest: string;
  trigger: string;
  rune: string;
  items: SkyQuestItem[];
  rewards: string[];
}

export interface SkyClass {
  className: string;
  code: string;
  giver: string;
  quests: SkyQuest[];
}

export interface SkyHolding {
  name: string;
  count: number;
  source: "inventory" | "loot" | "both";
  /** Where it was last seen: `inv`, `bank`, `shared`, `depot`, `keyring`, `DH`, `currency`. */
  where: string | null;
}

export interface SkyLoot {
  name: string;
  tsMs: number;
  from: string;
  /** The auto-storage it was routed into (`currency`, `tradeskill depot`, `Dragon Hoard`). */
  storedIn?: string;
}

/** A quest finished, dated by the `You have been given:` line. The reward identifies the
 *  quest — reward names are unique across the catalogue. */
export interface SkyCompletion {
  reward: string;
  tsMs: number;
  /** The quest finished, when the turn-in identified it. */
  quest: string | null;
}

export interface SkyStats {
  inventoryPath: string | null;
  inventoryMs: number | null;
  inventoryItems: number;
  held: SkyHolding[];
  recentLoot: SkyLoot[];
  /** Turn-ins the log witnessed, newest first. */
  completed: SkyCompletion[];
}

// ---- critical hits (self only, session-wide) ----

/** Which flag the crit arrived under. Three of the four never say "Critical" — the game emits
 *  them in its place — so a rate that reads only the literal word is short by their count. */
export type CritKind = "critical" | "crippling" | "slay" | "finishing";

/** Grouped by what can crit and how often, which is not the same split as `DamageType`.
 *  `proc` is the `non-melee` line form — procs and damage shields — and exists precisely
 *  because it is damage the game never flags. */
export type CritCategory = "melee" | "spell" | "dot" | "heal" | "proc";

/** `kind` is null when the hit was not a crit — which only `bestHit` produces, and which is not a
 *  corner case: this character's biggest spell hit is a 647 that never critted, against a biggest
 *  spell crit of 220. */
export interface CritRecord {
  amount: number;
  ability: string;
  target: string;
  tsMs: number;
  kind: CritKind | null;
  category: CritCategory;
}

export interface CritAbility {
  name: string;
  category: CritCategory;
  hits: number;
  crits: number;
  total: number;
  critTotal: number;
  best: CritRecord | null;
}

export interface CritCategoryStat {
  category: CritCategory;
  hits: number;
  crits: number;
  total: number;
  critTotal: number;
  /** False for a form that has never once carried a flag — the panel prints "—" rather than
   *  "0.0%", because "cannot crit" and "did not crit" are different answers. */
  crittable: boolean;
  byKind: Array<{ kind: CritKind; count: number }>;
  /** The biggest **crit**. Null until one lands. */
  best: CritRecord | null;
  /** The biggest hit of any kind — the outright record. Normally the same hit as `best`; the
   *  panel calls it out only when it is not. */
  bestHit: CritRecord | null;
  abilities: CritAbility[];
}

/** Which stretch of the log a crit view covers. */
export type CritWindowKey = "session" | "enc25" | "enc100" | "d14";

/** One category's all-time records — the badges that never move with the window, and that have
 *  to outlive the engine's 14-day retention on the per-hit log. */
export interface CritRecords {
  category: CritCategory;
  best: CritRecord | null;
  bestHit: CritRecord | null;
}

/** The crit figures over one window, fetched from `/api/crits` rather than pushed: the four
 *  together weigh about as much as the whole snapshot, for tables one tab reads. */
export interface CritWindow {
  key: CritWindowKey;
  fromMs: number | null;
  toMs: number | null;
  encounters: number;
  /** The log does not reach back as far as the window asks. */
  short: boolean;
  categories: CritCategoryStat[];
}

/** The crit tracker's live half, small enough to ride along on every push. */
export interface CritStats {
  records: CritRecords[];
  recent: CritRecord[]; // newest first
}

export interface CombatantStats {
  name: string;
  kind: EntityKind;
  isSelf: boolean;
  ownerName?: string; // for pets — the owner's display name
  damage: MetricStat; // damage done
  healing: MetricStat; // healing done
  taken: MetricStat; // damage taken
  stances?: StanceBreakdowns; // self only — damage by melee stance and by invocation
}

export interface StanceSegment {
  startMs: number;
  endMs: number | null;
  stance: string;
}

export interface EncounterCard {
  name: string;
  kind: EntityKind;
  isSelf: boolean;
  /** Which kind of pet, when `kind` is `"pet"` — they need different things said about them.
   *  Neither folds into anybody. */
  petKind?: "summoned" | "charmed";
  ownerName?: string; // the summoner, or the charmer when a charm cast identified one
  ambiguous?: boolean; // charmed mob sharing a name with its target — figures are the pair's exchange
  /** The owner is the best of several candidates of the casting class, not the only one.
   *  Shown as a name either way — a blank helps nobody — but marked as inference. */
  ownerGuess?: boolean;
  damage: MetricStat; // damage this character did to the NPC (per-person active window)
  healing: MetricStat; // healing this character did during their active window
  taken: MetricStat; // damage this character took from the NPC
  activeSec: number; // that window: their first contact with the NPC → the encounter's end
  pct: number; // share of total damage dealt to the NPC (for the bar)
}

export interface EncounterView {
  id: string;
  name: string;
  active: boolean;
  startMs: number;
  endMs: number;
  durationSec: number;
  total: number; // damage dealt to the NPC by everyone, over the whole encounter
  dps: number; // that total over the encounter span — the combined rate against the NPC
  npcDamage: MetricStat; // what the NPC dealt back, to everyone, over the same span
  selfSpark: number[]; // my dps per bucket across the span — self only, all zeros if I did nothing
  selfTakenSpark: number[]; // what this mob dealt me, per second, on the same buckets
  mobTakenSpark: number[]; // everything the group dealt this mob, same buckets
  mobDealtSpark: number[]; // everything it dealt the group
  sparkCombos: string[]; // "melee|invocation" holding the most of each bucket — colours the strip
  sparkBucketSec: number; // seconds each bucket covers (>= 1, the log's own resolution)
  cards: EncounterCard[]; // every contributor, ranked by damage share — the table folds the tail
}

export interface Fight {
  id: string;
  title: string;
  startMs: number;
  endMs: number | null;
  active: boolean;
  npcs: string[];
  combatants: CombatantStats[];
  stanceTimeline: StanceSegment[];
}

export interface FightSummary {
  id: string;
  title: string;
  startMs: number;
  endMs: number | null;
  active: boolean;
  durationSec: number;
  topDps: number;
}

export interface Snapshot {
  current: Fight | null;
  recent: FightSummary[];
  activeEncounters: EncounterView[];
  recentEncounters: EncounterView[];
  stance: StanceState;
  stanceOverview: StanceOverviewWindow[];
  encounterHistory: SelfEncounterPoint[]; // newest first, up to 50
  milestones: Milestone[]; // chronological, covering the retained encounter span
  progressWindows: ProgressWindow[]; // one per chart window (10/25/50)
  progress: ProgressState;
  deaths: DeathReport[]; // newest first, last 5
  stats: LongTermStats;
  motes: MoteStats;
  sky: SkyStats;
  crits: CritStats;
}

export interface LogInfo {
  path: string;
  fileName: string;
  character: string | null;
  server: string | null;
  sizeBytes: number;
  modifiedMs: number;
}

export interface LogsResponse {
  logDir: string | null;
  activeLogPath: string | null;
  logs: LogInfo[];
}

// ---- client-side filter state (History pane only — the Live pane is unfiltered) ----

export interface Filters {
  metric: MetricKind; // "rank by" — sorts character cards & drives the emphasized stat
  showPlayers: boolean;
  showNpcs: boolean;
}
