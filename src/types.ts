// Core domain types shared across tailer, parser, engine, and server.

// ---------------------------------------------------------------------------
// Logs / files
// ---------------------------------------------------------------------------

export interface LogFileInfo {
  path: string;
  fileName: string;
  character: string | null; // parsed from eqlog_<Char>_<server>.txt
  server: string | null;
  sizeBytes: number;
  modifiedMs: number; // mtime, ms since epoch
}

export type ParseMode = "live" | "backfill";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind = "self" | "player" | "pet" | "npc" | "unknown";

export interface Entity {
  name: string;
  kind: EntityKind;
  ownerName?: string; // for pets, when derivable
}

// ---------------------------------------------------------------------------
// Parsed combat events (output of the parser)
// ---------------------------------------------------------------------------

export type DamageType = "melee" | "spell" | "dot" | "unknown";

interface BaseEvent {
  tsMs: number; // event timestamp (ms) from the log line
  raw: string; // original line body, for debugging
}

export interface MeleeDamageEvent extends BaseEvent {
  type: "melee";
  attacker: string; // "You" is normalized to the self character name by the engine
  target: string;
  verb: string; // hit, slash, pierce, crush, kick, ...
  amount: number;
  crit: boolean;
  modifier?: string; // raw "(Critical)" etc.
}

export interface SpellDamageEvent extends BaseEvent {
  type: "spell";
  owner: string; // caster/owner: self name, another name, or "Unknown"
  target: string;
  effect: string; // "flames", "poison", ... (damage message, not the real spell name)
  amount: number;
}

export interface DotTickEvent extends BaseEvent {
  type: "dot";
  caster: string;
  target: string;
  spell: string; // real spell name (e.g. "Chords of Dissonance III")
  amount: number;
}

export interface MissEvent extends BaseEvent {
  type: "miss";
  attacker: string;
  target: string;
  verb: string;
  avoidance: string; // miss, parry, dodge, block, riposte, ...
}

export interface DeathEvent extends BaseEvent {
  type: "death";
  victim: string;
  killer: string | null;
}

export type StanceDim = "melee" | "invocation";

export interface StanceEvent extends BaseEvent {
  type: "stance";
  dim: StanceDim; // "melee" (assume … stance) or "invocation" (reciting … invocation)
  stance: string; // offensive/defensive/… or spellblade/arcane mastery/… (self only)
}

export interface HealEvent extends BaseEvent {
  type: "heal";
  healer: string;
  target: string;
  amount: number; // effective healing
  attempted?: number; // raw amount before overheal, when the "N (M)" form is used
  spell?: string; // when "by <Spell>" is present
}

export interface PetEvent extends BaseEvent {
  type: "pet";
  pet: string;
  owner: string; // "You" for the logging character's pet
}

export interface ZoneEvent extends BaseEvent {
  type: "zone";
  zone: string; // destination zone name — ends the current fight
}

export type CombatEvent =
  | MeleeDamageEvent
  | SpellDamageEvent
  | DotTickEvent
  | MissEvent
  | DeathEvent
  | StanceEvent
  | HealEvent
  | PetEvent
  | ZoneEvent;

// ---------------------------------------------------------------------------
// Aggregated views (output of the engine → sent to the UI)
// ---------------------------------------------------------------------------

export type MetricKind = "damage" | "healing" | "taken";

export interface AbilityBreakdown {
  name: string; // melee verb (kick/slash/…), spell name, or damage-shield effect
  damageType: DamageType; // "unknown" for healing categories
  total: number;
  hits: number;
  crits: number;
}

/** One metric group (damage done, healing done, or damage taken) for a combatant. */
export interface MetricStat {
  total: number;
  perSec: number; // DPS for damage/taken, HPS for healing
  hits: number;
  crits: number;
  avoided: number; // taken: attacks that missed/were avoided; else 0
  byType: Record<DamageType, number>; // populated for damage & taken; zeros for healing
  entries: AbilityBreakdown[]; // sorted by total desc; UI shows the top N as a table
}

export interface StanceBreakdown {
  stance: string;
  total: number;
  dps: number;
  activeSeconds: number;
}

/** Self damage split by each stance dimension (a character is in both at once). */
export interface StanceBreakdowns {
  melee: StanceBreakdown[];
  invocation: StanceBreakdown[];
}

/** The two stances active right now (self). */
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
  taken: MetricStat; // damage taken (tanking)
  stances?: StanceBreakdowns; // self only — damage by melee stance and by invocation
}

export interface StanceSegment {
  startMs: number;
  endMs: number | null;
  stance: string;
}

/** One attacker's damage against a specific NPC. */
export interface EncounterEntry {
  name: string;
  kind: EntityKind;
  isSelf: boolean;
  total: number;
  dps: number;
  pct: number;
}

/** A single NPC and the friendly damage dealt to it (a per-target DPS meter). */
export interface Encounter {
  name: string; // NPC display name
  active: boolean; // still alive in an active fight
  total: number; // total damage taken by this NPC
  dps: number;
  attackers: EncounterEntry[]; // friendly attackers, ranked by damage
}

export interface Fight {
  id: string;
  title: string; // named boss, or "Trash pull"
  startMs: number;
  endMs: number | null;
  active: boolean;
  npcs: string[]; // engaged NPC names
  combatants: CombatantStats[]; // per-character, all metrics
  encounters: Encounter[]; // per-NPC DPS breakdown
  stanceTimeline: StanceSegment[]; // self stance over the fight
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
