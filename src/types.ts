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

/** Character progression (self only) — what changed about *me* between fights. */
export type ProgressKind =
  | "level" // "You have gained a level! Welcome to level 34!"
  | "ap" // "You have gained 2 ability point(s)! You now have 4 ability point(s)."
  | "ability" // an AA bought or ranked up
  | "unlock" // "You have gained the ability to use Double Attack."
  | "skill" // "You have become better at Kick! (112)"
  | "xp"; // "You gain party experience! (8.995%)"

export interface ProgressEvent extends BaseEvent {
  type: "progress";
  kind: ProgressKind;
  name?: string; // ability / skill name
  value?: number; // level reached, AP gained, skill level, xp percent
  total?: number; // AP now unspent
  rank?: number; // AA rank, when the line names one
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
  | ZoneEvent
  | ProgressEvent;

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

/** Self DPS for one stance+invocation combination, averaged over recent fights. */
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

/** The last `n` finished encounters, split by stance combo. The window totals are taken
 *  before zero-damage combos are dropped from `rows`, so the headline rate is divided by
 *  every combat second — including ones I stood through without swinging. Those seconds
 *  are *merged* wall-clock: two mobs fought at once cost one second, not two. */
export interface StanceOverviewWindow {
  n: number;
  rows: StanceOverviewRow[]; // combos I dealt damage in, best DPS first
  damage: number; // my damage over the window…
  seconds: number; // …and the combat seconds behind it
}

/** A dated, one-off event worth a mark on the encounter timeline. Deliberately rare
 *  kinds only — skill-ups and xp ticks are counted in `ProgressWindow`, not marked. */
export type MilestoneKind = "level" | "ap" | "ability" | "death" | "zone";

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  tsMs: number;
  label: string; // short, drawn next to the glyph when there's room
  detail: string; // full sentence for the hover readout
  value?: number; // level reached / AP gained — what the window counters sum
}

/** Progression totals over the same 10/25/50-encounter window the chart plots. */
export interface ProgressWindow {
  n: number;
  levels: number;
  apGained: number;
  abilities: number; // AAs bought/ranked + skill unlocks
  skillUps: number;
  xpPct: number; // summed "% of a level" from xp ticks
  deaths: number;
}

/** Where I stand right now (latest values seen in the log). */
export interface ProgressState {
  level: number | null;
  abilityPoints: number | null; // unspent AP
}

/** One finished encounter, from my point of view — the history chart's data point.
 *  Both rates are normalised by the *encounter's* length, not by my own active window
 *  inside it (which is what the encounter table's rows use), so two bars are the same
 *  kind of number and their duration-weighted mean is a real per-second average. */
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

/** One character's contribution to a single mob encounter (ranked by damage). */
export interface EncounterCard {
  name: string;
  kind: EntityKind;
  isSelf: boolean;
  damage: MetricStat; // damage this character did to the NPC (per-person active window)
  healing: MetricStat; // healing this character did during their active window
  taken: MetricStat; // damage this character took from the NPC
  activeSec: number; // that window: their first contact with the NPC → the encounter's end
  pct: number; // share of total damage dealt to the NPC (for the bar)
}

/** One per-mob encounter (live or finished) with per-character rows. */
export interface EncounterView {
  id: string;
  name: string; // NPC display name
  active: boolean;
  startMs: number;
  endMs: number;
  durationSec: number;
  total: number; // damage dealt to the NPC by everyone, over the whole encounter
  dps: number; // that total over the encounter span — the combined rate against the NPC
  npcDamage: MetricStat; // what the NPC dealt back, to everyone, over the same span
  cards: EncounterCard[]; // self + top others, ranked by DPS
}

export interface Fight {
  id: string;
  title: string; // named boss, or "Trash pull"
  startMs: number;
  endMs: number | null;
  active: boolean;
  npcs: string[]; // engaged NPC names
  combatants: CombatantStats[]; // per-character, all metrics
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
