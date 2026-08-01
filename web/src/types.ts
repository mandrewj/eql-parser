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
  kind: EntityKind; // "pet" here always means a charmed mob — summoned pets fold into their owner
  isSelf: boolean;
  ownerName?: string; // charmed pets only, and only when a charm cast identified the charmer
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
  cards: EncounterCard[];
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
