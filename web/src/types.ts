// Frontend mirror of the server's view types (see ../../src/types.ts).

export type EntityKind = "self" | "player" | "pet" | "npc" | "unknown";
export type DamageType = "melee" | "spell" | "dot" | "unknown";

export interface AbilityBreakdown {
  name: string;
  damageType: DamageType;
  total: number;
  hits: number;
  crits: number;
}

export interface StanceBreakdown {
  stance: string;
  total: number;
  dps: number;
  activeSeconds: number;
}

export interface CombatantStats {
  name: string;
  kind: EntityKind;
  isSelf: boolean;
  total: number;
  dps: number;
  pct: number;
  hits: number;
  crits: number;
  misses: number;
  byType: Record<DamageType, number>;
  abilities: AbilityBreakdown[];
  stances?: StanceBreakdown[];
}

export interface StanceSegment {
  startMs: number;
  endMs: number | null;
  stance: string;
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
  stance: string;
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
  showPlayers: boolean;
  showNpcs: boolean;
  types: Record<Exclude<DamageType, "unknown">, boolean>;
  stance: string | null; // self-only lens; null = all stances
}

export const ALL_TYPES: Array<Exclude<DamageType, "unknown">> = ["melee", "spell", "dot"];
