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

export interface StanceOverviewWindow {
  n: number; // number of most-recent encounters averaged
  rows: StanceOverviewRow[];
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
  apGained: number;
  abilities: number;
  skillUps: number;
  xpPct: number;
  deaths: number;
}

export interface ProgressState {
  level: number | null;
  abilityPoints: number | null;
}

/** One finished encounter, from my point of view — the history chart's data point. */
export interface SelfEncounterPoint {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  durationSec: number;
  dps: number; // my damage per second in this encounter
  damage: number; // my total damage
  taken: number; // total damage I took
  melee: string; // stance combo I spent the most time in during this encounter
  invocation: string;
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
  damage: MetricStat; // damage this character did to the NPC (per-person active window)
  healing: MetricStat; // healing this character did during their active window
  taken: MetricStat; // damage this character took from the NPC
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

// ---- client-side filter state ----

export interface Filters {
  metric: MetricKind; // "rank by" — sorts character cards & drives the emphasized stat
  showPlayers: boolean;
  showNpcs: boolean;
}

export const ALL_TYPES: Array<Exclude<DamageType, "unknown">> = ["melee", "spell", "dot"];
