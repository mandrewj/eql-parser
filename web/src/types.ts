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

export interface EncounterEntry {
  name: string;
  kind: EntityKind;
  isSelf: boolean;
  total: number;
  dps: number;
  pct: number;
}

export interface Encounter {
  name: string;
  active: boolean;
  total: number;
  dps: number;
  attackers: EncounterEntry[];
}

export interface EncounterCard {
  name: string;
  kind: EntityKind;
  isSelf: boolean;
  damage: MetricStat; // damage this character did to the NPC
  taken: MetricStat; // damage this character took from the NPC
}

export interface RecentEncounter {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  durationSec: number;
  total: number;
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
  encounters: Encounter[];
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
  recentEncounters: RecentEncounter[];
  stance: StanceState;
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
