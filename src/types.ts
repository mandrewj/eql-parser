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

/** Which flag a critical hit arrived under.
 *
 *  `(Critical)` is the common one, but three more are critical hits under another name, and the
 *  game emits them **instead of** `(Critical)` rather than alongside it — so a rate that reads
 *  only the literal word is short by exactly their count. Measured over a 2M-line log: 26,463
 *  `(Critical)`, 363 `(Slay Undead)`, 114 `(Finishing Blow)`, 112 `(Crippling Blow)`.
 *
 *  The rest of the flag set is deliberately *not* here: `(Riposte)` and `(Strikethrough)` say how
 *  a swing resolved, `(Flurry)`, `(Rampage)` and `(Double Bow Shot)` say it was an extra one.
 *  Neither is a critical hit. */
export type CritKind = "critical" | "crippling" | "slay" | "finishing";

interface BaseEvent {
  tsMs: number; // event timestamp (ms) from the log line
  raw: string; // original line body, for debugging
}

/** The half of a damage event that says it critted. Flags **compose** — `(Riposte Strikethrough
 *  Critical)` occurs in a real log — so `crit` is the answer to "did this crit" and `critKind`
 *  names which of the four it was, for the breakdown. */
interface CritFlagged {
  crit?: boolean;
  critKind?: CritKind;
}

export interface MeleeDamageEvent extends BaseEvent, CritFlagged {
  type: "melee";
  attacker: string; // "You" is normalized to the self character name by the engine
  target: string;
  verb: string; // hit, slash, pierce, crush, kick, ...
  amount: number;
  crit: boolean;
  modifier?: string; // raw "(Critical)" etc.
}

/** Which line form a spell-damage event was read from. They look nothing alike and, more to the
 *  point, only one of them can ever be flagged as a critical:
 *
 *  - `ability` — `You hit orc taskmaster for 84 points of fire damage by Ignite. (Critical)`
 *  - `nonmelee` — `An orc is pierced by YOUR thorns for 12 points of non-melee damage.`
 *
 *  The `nonmelee` form carries no crit flag in 2M lines of log, because it is how procs and
 *  damage shields report and those do not crit. Folding the two together would divide 5 crits by
 *  55,000 hits and call the answer a spell crit rate, so the crit tracker keeps them apart.
 *
 *  Not exported: nothing outside this file names the type, only the field, and an export with no
 *  reader is the finding two audits here have already turned up. */
type SpellForm = "ability" | "nonmelee";

export interface SpellDamageEvent extends BaseEvent, CritFlagged {
  type: "spell";
  owner: string; // caster/owner: self name, another name, or "Unknown"
  target: string;
  /** For "non-melee" lines a damage *message* ("flames", "poison"); for typed ability
   *  damage the real ability name, which that form states outright ("Smiting Strike"). */
  effect: string;
  amount: number;
  form: SpellForm;
  crit?: boolean; // typed ability damage carries "(Critical)"; the non-melee form never does
}

export interface DotTickEvent extends BaseEvent, CritFlagged {
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

export interface HealEvent extends BaseEvent, CritFlagged {
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
  /** The auto-storage the game routed it into — `currency`, `tradeskill depot`, `Dragon Hoard`.
   *  Absent for an ordinary pickup, which simply lands in a bag. It is not decoration: the
   *  inventory export does **not** cover every one of these, and for those the log is the only
   *  witness the item was ever obtained. */
  storedIn?: string;
}

/** The game confirming it has written an inventory export:
 *  `Outputfile Complete: Sanluen_freeport-Inventory.txt`. Not combat, and never reaches the
 *  engine — the app takes it as the cue to re-read the export immediately. */
export interface OutputFileEvent extends BaseEvent {
  type: "outputfile";
  file: string;
}

/** An item handed over by an NPC: `You have been given: Espri`. This is what a completed
 *  turn-in writes, and the only line that puts a *date* on a quest completion — holding the
 *  reward says a quest is done, this says when. */
export interface GivenEvent extends BaseEvent {
  type: "given";
  item: string;
}

/** An item leaving your inventory in a trade: `You offered 1 Wind Rune Dena to Torgon
 *  Blademaster.` **The only line in the log that says something left.** Handing a quest in is a
 *  trade, so this is what a turn-in consumes — and without it the Sky counts could only rise. */
export interface TradeOfferEvent extends BaseEvent {
  type: "tradeOffer";
  item: string; // carries the upgrade suffix, e.g. "High Quality Raiment +1"
  count: number;
  to: string; // the NPC or player receiving it
}

/** `You complete the trade with Torgon Blademaster.` — the offers before it actually went
 *  through. Kept separate because an offer alone is not a loss. */
export interface TradeCompleteEvent extends BaseEvent {
  type: "tradeComplete";
  to: string;
}

/** `Welcome to EverQuest Legends!` — the client entering the world, and the only line that marks
 *  where a play session begins. Not combat: it arrives on a loading screen and must not open or
 *  extend a fight. Read by the crit tracker, whose "this session" window is measured from it. */
export interface LoginEvent extends BaseEvent {
  type: "login";
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
  | OutputFileEvent
  | GivenEvent
  | TradeOfferEvent
  | TradeCompleteEvent
  | LoginEvent
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
  /** Where it was last seen — `inv`, `bank`, `shared`, `depot`, `keyring`, `DH`, `currency`.
   *  The export's own slot when it can see the item; otherwise the storage the log said it was
   *  routed into. Null when neither knows. */
  where: string | null;
  /** `inventory` for the export's own contents, `loot` for something picked up since it was
   *  written, `both` when the two agree — which is the normal state for a stackable. */
  source: "inventory" | "loot" | "both";
}

/** A Sky item the log contributed. Usually a pickup after the inventory baseline — but an item
 *  routed to a storage the export does not list appears here whenever it was looted, because
 *  the log is the only record that it was obtained. */
export interface SkyLoot {
  name: string;
  tsMs: number;
  from: string; // the corpse
  /** The auto-storage it was routed into, when the game named one. */
  storedIn?: string;
}

/** A quest finished, dated. The reward alone identifies the quest — reward names are unique
 *  across the catalogue — so the UI resolves the quest and class rather than the snapshot
 *  carrying them. */
export interface SkyCompletion {
  reward: string;
  tsMs: number;
  /** The quest finished, when the turn-in identified it. Null for a completion recognised only
   *  by its reward. */
  quest: string | null;
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
  /** Turn-ins the log witnessed, newest first. Only ones it actually saw — a quest finished
   *  before this log begins is still `done` (the reward is held) but is not dated, which is
   *  why the panel lists these separately rather than every completed quest. */
  completed: SkyCompletion[];
}

// ---------------------------------------------------------------------------
// Critical hits (self only, session-wide)
// ---------------------------------------------------------------------------

/** How a crit rate is grouped. Not the same split as `DamageType`: that one classifies damage
 *  for the meters, this one classifies it by **what can crit and how often**, which is a
 *  different question — `proc` exists precisely because it is damage the game never flags. */
export type CritCategory =
  | "melee" // plain swings: `You slash X for 137 points of damage. (Riposte Critical)`
  | "spell" // named abilities: `You hit X for 84 points of fire damage by Ignite. (Critical)`
  | "dot" // ticks: `X has taken 33 damage from your Chords of Dissonance V. (Critical)`
  | "heal" // `You heal X for 210 (260) hit points by Superior Healing. (Critical)`
  | "proc"; // procs and damage shields — the `non-melee` form, which never carries a flag

/** A single hit worth remembering: the biggest of its kind, or one of the last few crits.
 *
 *  `kind` is null when the hit was not a crit at all — which only `bestHit` below produces, and
 *  which is not a corner case: this character's biggest spell hit is a 647 Denon's Desperate
 *  Dirge that never critted, against a biggest spell *crit* of 220. A records board that could
 *  only hold crits would report the 220 and read as broken to anyone who saw the 647 land. */
export interface CritRecord {
  amount: number;
  ability: string; // melee verb, spell name, or heal spell
  target: string;
  tsMs: number;
  kind: CritKind | null;
  category: CritCategory;
}

/** One ability's crit record. `hits` counts every landing, crit or not, so the rate below it
 *  divides by the same denominator the panel promises: times this ability dealt damage. */
export interface CritAbility {
  name: string;
  category: CritCategory;
  hits: number;
  crits: number;
  total: number; // damage (or healing) from every hit
  critTotal: number; // …and the part of it that critted
  best: CritRecord | null;
}

export interface CritCategoryStat {
  category: CritCategory;
  hits: number;
  crits: number;
  total: number;
  critTotal: number;
  /** False for the `proc` form, which the game has never once flagged. The panel prints "—"
   *  rather than "0.0%", because the two mean different things: one is a form that cannot
   *  crit, the other is a run of bad luck. */
  crittable: boolean;
  byKind: Array<{ kind: CritKind; count: number }>; // biggest first, zero kinds omitted
  /** The biggest **crit**. Null until one lands. */
  best: CritRecord | null;
  /** The biggest hit of any kind, crit or not — the category's outright record. Usually the same
   *  hit as `best` (a crit is normally the hardest thing you land), and the panel says so only
   *  when it is *not*, which is the case worth seeing. */
  bestHit: CritRecord | null;
  abilities: CritAbility[]; // most crits first, then most used
}

/** Which stretch of the log a crit view covers. Four, because they answer different questions:
 *  "how am I doing tonight", "did that last camp go well", "what is my rate really", and "how has
 *  it moved over the patch". */
export type CritWindowKey =
  | "session" // since the last `Welcome to EverQuest Legends!`, capped at 12h
  | "enc25" // the last 25 per-mob encounters
  | "enc100" // …and the last 100
  | "d14"; // the last 14 days

/** One category's all-time records. Kept apart from the windowed figures and **kept in the
 *  snapshot**, because "highest ever" is the one reading that must never move with the window —
 *  and because it has to outlive the per-hit log's retention trim. */
export interface CritRecords {
  category: CritCategory;
  best: CritRecord | null; // biggest crit ever
  bestHit: CritRecord | null; // biggest hit ever, crit or not
}

/** The crit figures over one window. Served from `/api/crits`, not pushed: four of these is 72KB
 *  on top of a 92KB snapshot, for data one tab reads — the same trade the Sky catalogue was kept
 *  out of the snapshot for. */
export interface CritWindow {
  key: CritWindowKey;
  /** What the window actually covers, resolved against the log rather than promised. Null when
   *  it holds nothing at all. */
  fromMs: number | null;
  toMs: number | null;
  /** Encounters spanned — for the encounter windows, how many they really reached back over. */
  encounters: number;
  /** True when the log does not reach back as far as the window asks. The panel says so rather
   *  than presenting a short window as a full one. */
  short: boolean;
  categories: CritCategoryStat[]; // fixed order, present even when empty
}

/** The crit tracker's live half — small enough to ride along on every push. The windowed tables
 *  are fetched separately; these two are what the panel shows without asking for anything. */
export interface CritStats {
  records: CritRecords[]; // one per category, all-time
  recent: CritRecord[]; // newest first — the "did that just crit" readout
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
