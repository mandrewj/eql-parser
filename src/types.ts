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
  /** For "non-melee" lines a damage *message* ("flames", "poison"); for typed ability
   *  damage the real ability name, which that form states outright ("Smiting Strike"). */
  effect: string;
  amount: number;
  crit?: boolean; // typed ability damage carries "(Critical)"; the non-melee form never does
}

export interface DotTickEvent extends BaseEvent {
  type: "dot";
  caster: string;
  target: string;
  spell: string; // real spell name (e.g. "Chords of Dissonance III")
  amount: number;
  crit?: boolean; // "(Critical)" after the terminator — ticks crit too
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
  crit?: boolean; // "(Critical)" after the terminator — heals crit too
}

export interface PetEvent extends BaseEvent {
  type: "pet";
  pet: string;
  owner: string; // "You" for the logging character's pet
}

/** A mob fighting on our side. The log splits this across lines that never share a
 *  subject — the landing names the mob but no caster, the cast names the caster but
 *  no target — so the parser emits both halves and the engine pairs them by time. */
export interface CharmEvent extends BaseEvent {
  type: "charm";
  state: "cast" | "on" | "off";
  /** The caster for "cast"; the charmed mob for "on"/"off". Empty on a break that
   *  names only the spell (a bard's song ending), meaning every mob that spell holds. */
  who: string;
  spell?: string; // the charm spell, when the line names one
  /** Which landing message it was ("on" only). The message identifies the spell and the
   *  spell identifies the caster's class, which is the only handle the log gives on who
   *  owns a charm nobody's cast line announced. See `spells.ts`. */
  emote?: CharmEmoteKind;
}

/** The charm landing messages the parser recognises, keyed as in `spells.ts`. */
export type CharmEmoteKind = "charmed" | "glaze";

/** A `/who` line: `[42 PAL/MNK/BRD] Sanluen (Wood Elf) <Guild> ZONE: Nagafen's Lair`.
 *  The only place the log states anyone's class, which is what lets a charm emote be
 *  traced back to a specific groupmate. */
export interface WhoEvent extends BaseEvent {
  type: "who";
  name: string;
  level: number;
  classes: string[]; // e.g. ["PAL", "MNK", "BRD"]
}

/** An item kept from a corpse: `--You have looted a Mote of Minor Potential from a fire giant
 *  warrior's corpse.--`. Only this form is parsed, not the "and sold it for…" or "to create…"
 *  variants — it is the one that means the item is yours, and the only one motes ever use. */
export interface LootEvent extends BaseEvent {
  type: "loot";
  item: string;
  from: string; // the corpse it came off
}

export interface ZoneEvent extends BaseEvent {
  type: "zone";
  /** Destination zone, or null for the unnamed half of a transition (`LOADING, PLEASE
   *  WAIT.`). Either way it ends the current fight; only a named one moves the zone. */
  zone: string | null;
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
  value?: number; // level reached, AA gained, skill level, xp percent
  total?: number; // AA now unspent
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
  | CharmEvent
  | WhoEvent
  | LootEvent
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
  value?: number; // level reached / AA gained — what the window counters sum
}

/** Progression totals over the same 10/25/50-encounter window the chart plots. */
export interface ProgressWindow {
  n: number;
  levels: number;
  aaGained: number;
  abilities: number; // AAs bought/ranked + skill unlocks
  skillUps: number;
  xpPct: number; // summed "% of a level" from xp ticks
  deaths: number;
}

/** Where I stand right now (latest values seen in the log). */
export interface ProgressState {
  level: number | null;
  aaUnspent: number | null; // unspent Alternate Advancement
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

/** One incoming hit in the run-up to a death. */
export interface DeathBlow {
  tsMs: number;
  attacker: string;
  ability: string; // melee verb, spell name, or damage-shield effect
  amount: number;
  damageType: DamageType;
  crit: boolean;
}

/** What killed me. Assembled at the moment of death from a rolling log of incoming hits, so
 *  it needs no new parsing — every field here was already in the stream, just never kept
 *  together. The window is fixed rather than "since I was last at full": the log never states
 *  hit points, so there is no way to know when the trouble started. */
export interface DeathReport {
  id: string;
  tsMs: number;
  killer: string;
  windowSec: number; // how far back `blows` reaches
  totalTaken: number; // damage taken inside that window
  healed: number; // healing received inside it — was anyone trying?
  blows: DeathBlow[]; // chronological; the last is the killing blow
  byAttacker: Array<{ name: string; total: number }>; // biggest first
  byAbility: Array<{ name: string; total: number; damageType: DamageType }>;
  melee: string; // the stance combo I died in
  invocation: string;
}

/** One stretch of play between two milestones — or the open one since the newest.
 *
 *  `label` names what *ended* the stretch ("level 44"), so a completed row reads as "this is
 *  what that level cost". The open row is what has happened since, and is marked. Counters are
 *  kept as running session totals and snapshotted at each milestone, so every span here is a
 *  subtraction of two snapshots rather than a scan — and it survives `milestones` being
 *  trimmed as encounters age out. */
export interface MilestoneSpan {
  label: string;
  tsMs: number | null; // when the stretch ended; null for the open one
  kills: number;
  zones: number;
  combatSec: number;
  /** Where I was standing when the milestone landed. Null on the open row, which has no
   *  milestone of its own — and on any that landed before the first zone line was seen. */
  zone?: string | null;
  open?: boolean; // the still-running stretch since the newest milestone
}

/** Time in each stance since I last entered the zone I am in now. Scoped to the zone because
 *  that is the unit of "what am I doing here" — a camp, not a session. */
export interface ZoneStance {
  zone: string | null;
  sinceMs: number | null;
  melee: Array<{ stance: string; seconds: number }>; // biggest first
  invocation: Array<{ stance: string; seconds: number }>;
}

export interface LongTermStats {
  /** Newest first: the open stretch, then the last 2 levels earned. */
  levels: MilestoneSpan[];
  /** Newest first: the open stretch, then the last 4 ability points earned. */
  aa: MilestoneSpan[];
  zoneStance: ZoneStance;
}


/** One rung of the mote ladder. Present for every tier, including ones never seen, so the
 *  table reads as a ladder rather than a list of whatever happened to drop. */
export interface MoteTierStat {
  tier: string;
  label: string;
  total: number; // this session
  lastMs: number | null;
  lastFrom: string | null; // the corpse it came off
  /** Mean gap over the **last 10** drops of this tier — a recent rate, not a session average,
   *  so moving somewhere better shows up quickly. Null until there are enough to mean
   *  anything; `samples` says how many there were either way. */
  avgGapSec: number | null;
  samples: number;
}

/** A single drop, for the short "just looted" list above the table. */
export interface MoteLoot {
  tier: string;
  label: string;
  tsMs: number;
  from: string; // the corpse
  zone: string | null;
  difficulty: number | null; // 0–4, or null before the first zone line
}

export interface MoteStats {
  tiers: MoteTierStat[];
  /** Counts over the last 250 loots: `grid[tier][difficulty]`, difficulty 0–4. */
  grid: number[][];
  /** Column totals, and how many of the 250 had no known zone (before the first zone line). */
  perDifficulty: number[];
  unknownZone: number;
  windowSize: number; // how many loots the grid actually covers (≤ 250)
  recent: MoteLoot[]; // newest first
}

/** One Plane of Sky item the character holds, and where that knowledge came from.
 *  Only catalogue names appear here — the rest of the inventory is nobody's business. */
export interface SkyHolding {
  /** The catalogue's spelling, not the game's, so the UI can key straight off it. */
  name: string;
  count: number;
  /** `inventory` for the export's own contents, `loot` for something picked up since it was
   *  written, `both` when the two agree — which is the normal state for a stackable. */
  source: "inventory" | "loot" | "both";
}

/** A Sky item picked up after the inventory baseline: the part the log contributes. */
export interface SkyLoot {
  name: string;
  tsMs: number;
  from: string; // the corpse
}

/** The Sky tracker's *dynamic* half. The catalogue itself is immutable and is served once from
 *  `/api/sky-quests` rather than repeated on every push — at 28KB it would have been a third
 *  again on top of a 90KB snapshot, for data that never changes for the life of the process. */
export interface SkyStats {
  /** The export the baseline came from. Null when the character has never run
   *  `/outputfile inventory`, which is the normal starting state and not an error. */
  inventoryPath: string | null;
  /** When the game last wrote that file. Loot after this point is added on top of it;
   *  loot before it is already counted in it and must not be double-counted. */
  inventoryMs: number | null;
  /** Non-empty slots read, so the UI can say the export was understood rather than just found. */
  inventoryItems: number;
  held: SkyHolding[];
  /** Newest first, capped for display. */
  recentLoot: SkyLoot[];
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
  kind: EntityKind; // "pet" here always means a charmed mob — summoned pets fold into their owner
  isSelf: boolean;
  ownerName?: string; // charmed pets only, and only when a charm cast identified the charmer
  /** A charmed mob that shares its name with the mob it was sent at. The log gives both
   *  the same key and its blows are identical either way, so this row's figures are the
   *  whole exchange between the pair — an upper bound on the pet, not its output alone. */
  ambiguous?: boolean;
  /** The owner is the best of several candidates of the casting class, not the only one.
   *  Shown as a name either way — a blank helps nobody — but marked as inference. */
  ownerGuess?: boolean;
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
  selfSpark: number[]; // my dps per bucket across the span — self only, all zeros if I did nothing
  selfTakenSpark: number[]; // what this mob dealt me, per second, on the same buckets
  /** The mob's own half of the timeline, on the same buckets: everything the *group* dealt it,
   *  and everything it dealt the group. Not filtered to me — that is what the other pair is. */
  mobTakenSpark: number[];
  mobDealtSpark: number[];
  sparkCombos: string[]; // "melee|invocation" holding the most of each bucket — colours the strip
  sparkBucketSec: number; // seconds each bucket covers (>= 1, the log's own resolution)
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
