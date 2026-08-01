// Combat engine: consumes CombatEvents in chronological order and produces
// fights with three per-combatant metric groups — damage done, healing done,
// and damage taken (tanking) — each with a total + per-category breakdown, plus
// a self damage-by-stance view.
//
// Friend/foe classification from a single client's log is inherently fuzzy, so
// we don't trust names' capitalization (EQ capitalizes the first word of a line,
// making "Orc legionnaire" and "orc legionnaire" the same mob). Entities are
// keyed case-insensitively and classified by iterative propagation from strong
// seeds: the self only attacks/is attacked by NPCs, "You have slain X" ⇒ X is an
// NPC, and heals connect same-faction pairs.

import { CHARM_EMOTES, type ClassCode } from "../parser/spells.js";
import { MOTE_TIERS, moteLabel, moteTier, zoneDifficulty, type MoteTier } from "../parser/motes.js";
// The inventory's keys are already normalised, and normalising twice is a no-op, so the same
// lookup serves both the export and the log.
import { matchSkyItem } from "../parser/sky.js";
import { isUnexportedStorage, type Inventory } from "../parser/inventory.js";
import type {
  AbilityBreakdown,
  MoteStats,
  MoteTierStat,
  SkyStats,
  SkyHolding,
  SkyCompletion,
  LongTermStats,
  MilestoneSpan,
  ZoneStance,
  DeathBlow,
  DeathReport,
  CharmEmoteKind,
  CharmEvent,
  CombatEvent,
  CombatantStats,
  DamageType,
  EncounterCard,
  EncounterView,
  Fight,
  FightSummary,
  MetricStat,
  Milestone,
  MilestoneKind,
  ProgressEvent,
  ProgressState,
  ProgressWindow,
  SelfEncounterPoint,
  StanceBreakdown,
  StanceDim,
  StanceOverviewWindow,
  StanceSegment,
  StanceState,
} from "../types.js";

const STANCE_DIMS: StanceDim[] = ["melee", "invocation"];

/** How long after a charm cast a landing can still be attributed to it. Measured on a
 *  real log: 128 of 153 charm landings sat within 3s of a charm cast, and only one more
 *  arrived by 6s — so widening the window buys almost nothing and risks crediting the
 *  wrong enchanter in a busy camp. Landings outside it simply get no owner. */
const CHARM_ATTRIB_MS = 3000;

/** A swing already in the air when the charm lands still connects, so the mob hits a
 *  friendly a second *after* becoming a pet. Blows inside this window therefore can't
 *  be read as the charm breaking. (Real case: a wan ghoul knight glazed at 03:35:56
 *  and struck Hugh at 03:35:57, then spent the rest of the fight on our side.) */
const CHARM_GRACE_MS = 3000;

/** How far back a death report looks. The log never states hit points, so "since I was last
 *  at full" is unknowable and a fixed window is the honest substitute. Ten seconds covers the
 *  burst that actually kills — on a real death: four attackers, a 209-damage nuke, a DoT tick
 *  and a damage shield, all inside the last three. */
const DEATH_WINDOW_SEC = 10;

/** How long a mob can go untouched before its encounter is over. Separate from the *fight*
 *  timeout: a pull can stay open while one particular mob is left alone. Without it a boss
 *  that hit you once, was abandoned for fourteen minutes and then fought properly reports a
 *  single encounter spanning the whole gap, and every rate divides by the idle time — a real
 *  Lady Vox read 669s at 79 dps when the actual fight was a fraction of that. */
const ENCOUNTER_IDLE_SEC = 60;

/** How much of an encounter must have happened before it earns a bar on the history chart.
 *  Below this a rate is mostly noise, and each half of the chart is scaled to its own peak,
 *  so one early crit would rescale every other bar. */
const LIVE_POINT_MIN_SEC = 5;

/** The key a charmed mob takes when it turns out to share its name with a mob we are
 *  fighting. Entities are keyed by name, so until then the two are one entity; a blow
 *  between them ("A fire giant warrior slashes a fire giant warrior") is the proof that
 *  they are not, since nothing attacks itself. The suffix can't collide with a real name
 *  because the log is ASCII throughout, so a non-ASCII marker is unreachable from it.
 *  (It was a NUL until that quietly turned this file binary to git and grep.) */
const twinKey = (key: string): string => `${key}§charmed`;
const isTwinKey = (key: string): boolean => key.endsWith("§charmed");

/** A milestone with the running counters as they stood when it landed. */
interface Anchor {
  label: string;
  tsMs: number;
  zone: string | null; // where I was standing when it landed
  kills: number;
  zones: number;
  combatMs: number;
}

/** How many completed stretches each box shows. A level is slow enough that two is a
 *  comparison; ability points come fast enough that four is. */
const LEVEL_SPANS = 2;
const AA_SPANS = 4;

/** Who holds a charm, and since when. */
interface CharmHold {
  ownerKey: string | null; // the charmer, when a cast within CHARM_ATTRIB_MS identified one
  /** True when `ownerKey` is the best of several candidates rather than the only one — the
   *  card says so, because a name presented as fact should have been deduced, not picked. */
  ownerGuess: boolean;
  spell: string | null;
  sinceMs: number;
}

export interface EngineOptions {
  selfName: string; // resolved from the log filename; "You" maps to this
  inactivityTimeoutSec: number;
  now?: () => number; // injectable clock for encounter staleness (defaults to Date.now)
}

interface AbilityAgg {
  name: string;
  damageType: DamageType;
  total: number;
  hits: number;
  crits: number;
}

interface MetricAcc {
  total: number;
  hits: number;
  crits: number;
  avoided: number;
  byType: Record<DamageType, number>;
  abilities: Map<string, AbilityAgg>;
}

interface CombatantAgg {
  key: string;
  name: string;
  done: MetricAcc; // damage done
  heal: MetricAcc; // healing done
  taken: MetricAcc; // damage taken
  stanceTotals: Record<StanceDim, Map<string, number>>; // self only, damage by each stance dim
}

interface FightState {
  id: string;
  startMs: number;
  endMs: number | null;
  lastActivityMs: number;
  combatants: Map<string, CombatantAgg>;
  damagePairs: Array<[string, string]>; // [attackerKey, targetKey], incl. misses
  healPairs: Array<[string, string]>; // [healerKey, targetKey] — same faction
  healLog: Array<{ healer: string; amount: number; spell: string; tsMs: number }>; // for windowed HPS
  deaths: Array<{ victim: string; killer: string | null; killerSelf: boolean }>;
  npcSeeds: Set<string>;
  targetIncoming: Map<string, { name: string; total: number }>;
  perTarget: Map<string, Map<string, MetricAcc>>; // targetKey → attackerKey → damage breakdown
  selfHits: Map<string, Array<{ ts: number; amount: number }>>; // targetKey → my damage, timestamped
  /** npcKey → what that mob dealt *me*, timestamped. The mirror of `selfHits`, and per-mob for
   *  the same reason: `selfTakenComboLog` is per-session, so during a two-mob pull it would
   *  draw a strip that disagreed with the row above it. */
  selfTaken: Map<string, Array<{ ts: number; amount: number }>>;
  /** The same two series widened to *everyone*, for the mob's own half of the timeline:
   *  `hitsOn[mob]` is what the whole group did to it, `hitsBy[mob]` what it did to the whole
   *  group. The self logs above stay separate rather than being derived from these — the left
   *  chart is specifically mine, and filtering these per render would cost a scan per bucket. */
  hitsOn: Map<string, Array<{ ts: number; amount: number }>>;
  hitsBy: Map<string, Array<{ ts: number; amount: number }>>;
  pairFirst: Map<string, number>; // "attackerKey>targetKey" → first contact ms (per-person start)
  firstSeen: Map<string, number>; // entityKey → first event ms (encounter start)
  lastSeen: Map<string, number>; // entityKey → last event ms (for per-NPC staleness)
  aliveEngaged: Set<string>;
  /** Every key charmed at any point in this fight, whether or not it still is. A charm on a
   *  name we are also *fighting* flickers constantly — our swings at the other mobs of that
   *  name land on the shared key and read as swings at our own pet — so the live flag is a
   *  poor test of whose side a blow was struck for. This is the durable one: a hostile mob
   *  has no reason to attack another mob, so damage from a sometimes-charmed key to a mob is
   *  pet damage regardless of what the flag says at that instant. */
  everCharmed: Set<string>;
}

/** Append a timestamped hit to a per-key log, creating the log on first use. Module level
 *  rather than a closure inside `recordDamage`: that runs on every damage event in the log. */
function pushHit(
  m: Map<string, Array<{ ts: number; amount: number }>>,
  key: string,
  ts: number,
  amount: number,
): void {
  const at = m.get(key);
  if (at) at.push({ ts, amount });
  else m.set(key, [{ ts, amount }]);
}

const emptyByType = (): Record<DamageType, number> => ({ melee: 0, spell: 0, dot: 0, unknown: 0 });

/** A metric with only a total + per-second (no per-ability breakdown) — used for healing rows. */
const rateStat = (total: number, dur: number): MetricStat => ({
  total,
  perSec: Math.round(total / dur),
  hits: 0,
  crits: 0,
  avoided: 0,
  byType: emptyByType(),
  entries: [],
});
const newMetric = (): MetricAcc => ({
  total: 0,
  hits: 0,
  crits: 0,
  avoided: 0,
  byType: emptyByType(),
  abilities: new Map(),
});

function addAbility(m: MetricAcc, name: string, type: DamageType, amount: number, crit: boolean): void {
  m.total += amount;
  m.hits++;
  if (crit) m.crits++;
  if (type !== "unknown") m.byType[type] += amount;
  const key = `${type}:${name.toLowerCase()}`;
  let a = m.abilities.get(key);
  if (!a) {
    a = { name, damageType: type, total: 0, hits: 0, crits: 0 };
    m.abilities.set(key, a);
  }
  a.total += amount;
  a.hits++;
  if (crit) a.crits++;
}

/** Most buckets an encounter sparkline is cut into: 40 fixed 12px slots is the panel's
 *  ~490px of usable width. Buckets never go under a second — the log's own resolution —
 *  so a short fight is simply drawn with fewer of them, and a long one widens them. */
const SPARK_BUCKETS = 40;

/** My damage to one mob, as a rate per bucket across the encounter's span. Leading empties
 *  are meaningful: they are the seconds the mob was up before I engaged it, which is what
 *  the row's `time` column reports as a number. */
function sparkline(
  hits: ReadonlyArray<{ ts: number; amount: number }>,
  startMs: number,
  spanSec: number,
): { spark: number[]; bucketSec: number } {
  const bucketSec = Math.max(1, Math.ceil(spanSec / SPARK_BUCKETS));
  const count = Math.max(1, Math.ceil(spanSec / bucketSec));
  const spark = new Array<number>(count).fill(0);
  for (const h of hits) {
    const i = Math.min(count - 1, Math.max(0, Math.floor((h.ts - startMs) / (bucketSec * 1000))));
    spark[i]! += h.amount;
  }
  // A bucket holds damage; the chart plots rates, so divide by the seconds it covers.
  return { spark: spark.map((d) => Math.round(d / bucketSec)), bucketSec };
}

/** First index whose `ts` is >= `from`, by bisection — the timestamped logs are appended in
 *  chronological order and only ever trimmed from the front, so they stay sorted. */
function lowerBound(log: ReadonlyArray<{ ts: number }>, from: number): number {
  let lo = 0;
  let hi = log.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (log[mid]!.ts < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Merge one raw metric accumulator into another (used to fold pet → owner per encounter). */
function mergeAcc(dst: MetricAcc, src: MetricAcc, petTag: string | null): void {
  dst.total += src.total;
  dst.hits += src.hits;
  dst.crits += src.crits;
  dst.avoided += src.avoided;
  (Object.keys(dst.byType) as DamageType[]).forEach((t) => (dst.byType[t] += src.byType[t]));
  for (const [k, a] of src.abilities) {
    const key = petTag ? `pet:${k}` : k;
    const existing = dst.abilities.get(key);
    if (existing) {
      existing.total += a.total;
      existing.hits += a.hits;
      existing.crits += a.crits;
    } else {
      dst.abilities.set(key, {
        name: petTag ? `${petTag} ${a.name}` : a.name,
        damageType: a.damageType,
        total: a.total,
        hits: a.hits,
        crits: a.crits,
      });
    }
  }
}

/** Fold a pet's metric into its owner's (operates on already-built output objects). */
function mergeStat(dst: MetricStat, src: MetricStat, dur: number): void {
  if (src.total === 0 && src.avoided === 0 && src.entries.length === 0) return;
  dst.total += src.total;
  dst.hits += src.hits;
  dst.crits += src.crits;
  dst.avoided += src.avoided;
  (Object.keys(dst.byType) as DamageType[]).forEach((t) => (dst.byType[t] += src.byType[t]));
  for (const e of src.entries) {
    dst.entries.push({ name: `🐾 ${e.name}`, damageType: e.damageType, total: e.total, hits: e.hits, crits: e.crits });
  }
  dst.entries.sort((a, b) => b.total - a.total);
  dst.perSec = Math.round(dst.total / dur);
}

export class Engine {
  private readonly opts: EngineOptions;
  private readonly selfKey: string;
  private readonly display = new Map<string, string>();

  private readonly currentStances: StanceState = { melee: "none", invocation: "none" };
  private readonly stanceSegments: Record<StanceDim, StanceSegment[]> = { melee: [], invocation: [] };
  // Combined stance+invocation timeline + a log of self damage by combo, for per-combination DPS.
  private readonly comboSegments: Array<{ startMs: number; endMs: number; combo: string }> = [];
  private comboStartMs = 0;
  private readonly selfComboLog: Array<{ combo: string; amount: number; ts: number }> = [];
  // Same, for damage *taken* — so a combo's defensive cost sits next to its DPS.
  private readonly selfTakenComboLog: Array<{ combo: string; amount: number; ts: number }> = [];
  private readonly petOwners = new Map<string, string>(); // petKey → ownerKey (global)
  // Mobs currently fighting on our side. Unlike `petOwners` this is a *window*, not a
  // fact: the same mob is an enemy before the charm and again after it breaks, so the
  // engine closes out its encounter at each boundary rather than picking one side.
  private readonly charmed = new Map<string, CharmHold>();
  // The mirror case: one of *ours* charmed away from us. Charm flips allegiance, so on a mob it
  // makes them our pet and on a player it makes them the enemy — seeding them friendly, as a
  // charmed mob is, would hide the damage they are now dealing the group. Rare enough that a
  // real 900k-line log contains none, but a long fight is exactly where it happens.
  private readonly charmedAway = new Set<string>();
  // The last few seconds of charm casts, purely to put an owner on the next landing —
  // the landing line never names one. Trimmed to CHARM_ATTRIB_MS, so it stays tiny.
  private charmCasts: Array<{ casterKey: string; spell: string; ts: number }> = [];
  // playerKey → their classes, from `/who`. The log states a class nowhere else, and it is
  // what turns a charm's landing message into a name: the message identifies the spell, the
  // spell identifies the class, and a fight with one member of that class has one candidate.
  private readonly classes = new Map<string, string[]>();
  // playerKey → how often we have *seen* them cast a charm, and when last. Ranks the
  // candidates when a fight holds several of the casting class: someone who has charmed in
  // front of us is a better bet than a groupmate who merely has the class on their /who.
  private readonly charmCasters = new Map<string, { casts: number; lastTs: number }>();
  // mobKey → the last owner we resolved for it. A charm on a name we are also fighting is
  // broken and re-inferred constantly, and the re-inference has no landing message to work
  // from — so without this the pet reverts to "owner unknown" the moment its charm flickers,
  // discarding an attribution we had already earned.
  private readonly lastCharmOwner = new Map<string, { ownerKey: string | null; guess: boolean }>();
  // Incoming hits and heals, with the attacker and ability the other self-logs drop. Kept only
  // as long as a death report could still reach back for them, so this stays a few dozen
  // entries rather than a session-length history.
  private readonly selfBlows: DeathBlow[] = [];
  private readonly selfHealsIn: Array<{ tsMs: number; amount: number }> = [];
  private readonly deaths: DeathReport[] = []; // newest first, last 5
  private deathSeq = 0;

  // Running session totals for the long-term boxes. Snapshotting these when a level or an
  // ability point lands makes "since then" a subtraction, which is both O(1) and immune to
  // `milestones` being trimmed as encounters age out — the anchor would otherwise vanish
  // exactly when the stretch it measures got interesting.
  private totals = { kills: 0, zones: 0, combatMs: 0 };
  // Newest first. One more anchor than the number of completed spans shown, because a span is
  // the gap *between* two of them: 2 levels needs 3, 4 ability points needs 5.
  private readonly levelAnchors: Anchor[] = [];
  private readonly aaAnchors: Anchor[] = [];
  private zone: { name: string; sinceMs: number } | null = null;
  // Mote drops. Two windows, because the two readings want different ones: the grid wants the
  // last 250 loots whatever their tier, and each tier's gap wants that tier's own last 10 — a
  // rare tier would otherwise fall out of a shared window entirely and never show a rate.
  private readonly moteRecent: Array<{
    tier: MoteTier;
    tsMs: number;
    from: string;
    zone: string | null;
    difficulty: number | null;
  }> = [];
  private readonly moteByTier = new Map<MoteTier, { at: number[]; total: number; from: string }>();

  // Plane of Sky. The inventory export is the baseline and the log carries what has happened
  // since, so this array is deliberately **not** filtered as it is recorded: the cut-off is the
  // export's mtime, and that moves whenever the player writes a new one. Filtering at snapshot
  // time means a fresh export re-baselines instantly, with no replay. Uncapped because Sky items
  // are rare — a full clear of the zone is a few dozen — and an undercount would be worse than
  // the memory.
  private readonly skyLoot: Array<{ name: string; tsMs: number; from: string; storedIn?: string }> = [];
  private inventory: Inventory | null = null;
  /** Where the export for the active log *would* be. Held separately from `inventory` because
   *  a missing file still has an answer, and "waiting for <this file>" is a different message
   *  from "no character selected". */
  private inventoryExpectedPath: string | null = null;
  /** Turn-ins the log witnessed, chronological. Never filtered by the export's cut-off: this is
   *  a dated *event*, not a claim about what is currently held. */
  private readonly skyCompleted: SkyCompletion[] = [];

  // Progression. `milestones` holds only the rare, markable kinds (they end up as glyphs
  // on the chart's timeline); skill-ups and xp ticks are far too frequent to mark, so they
  // live in `progressLog` and only ever feed the window counters. Both are trimmed with
  // the combo logs when an encounter ages out.
  private readonly milestones: Milestone[] = []; // chronological
  private readonly progressLog: Array<{ ts: number; kind: "skill" | "xp"; value: number }> = []; // chronological
  private readonly progress: ProgressState = { level: null, aaUnspent: null };
  private milestoneSeq = 0;

  private current: FightState | null = null;
  private finished: FightState[] = [];
  private finishedSummaries: FightSummary[] = []; // cached; a closed fight never changes
  private finishedEncounters: EncounterView[] = []; // newest first, rolling
  private overviewCache: StanceOverviewWindow[] | null = null;
  private historyCache: SelfEncounterPoint[] | null = null;
  private progressCache: ProgressWindow[] | null = null;
  private fightSeq = 0;
  private encounterSeq = 0;
  private readonly now: () => number;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.selfKey = opts.selfName.toLowerCase();
    this.display.set(this.selfKey, opts.selfName);
    this.now = opts.now ?? (() => Date.now());
  }

  // --- public API ---------------------------------------------------------

  /** Close the current fight if it has been idle past the inactivity window
   *  (wall-clock based, so an abandoned fight ends without any new log lines). */
  tick(): boolean {
    if (this.current && this.now() - this.current.lastActivityMs > this.opts.inactivityTimeoutSec * 1000) {
      this.closeFight(this.current.lastActivityMs);
      return true;
    }
    return false;
  }

  get hasCurrent(): boolean {
    return this.current !== null;
  }

  handle(ev: CombatEvent): void {
    if (ev.type === "stance") {
      this.applyStance(ev.tsMs, ev.dim, ev.stance);
      return;
    }
    if (ev.type === "pet") {
      const pk = this.keyOf(ev.pet);
      this.see(pk, ev.pet);
      const ownerKey = this.keyOf(ev.owner);
      // A *charmed* mob calling you Master is naming its charmer, not a summoner. Filing
      // it in `petOwners` would fold it into that owner's row — and where it shares a name
      // with the mob it was sent at, would fold the enemy in with it. It is also the best
      // ownership evidence there is, better than the cast we time-matched: this line says
      // outright whose pet it is, so it overwrites a guess rather than deferring to one.
      const charmKey = this.charmed.has(pk) ? pk : this.charmed.has(twinKey(pk)) ? twinKey(pk) : null;
      if (charmKey) this.charmed.get(charmKey)!.ownerKey = ownerKey;
      else this.petOwners.set(pk, ownerKey);
      return;
    }
    if (ev.type === "loot") {
      // Not combat: looting must not open a fight or extend one.
      const tier = moteTier(ev.item);
      if (tier) this.recordMote(tier, ev.from, ev.tsMs);
      // A Sky item is never also a mote, so this is an independent test rather than an else.
      const sky = matchSkyItem(ev.item);
      if (sky) this.skyLoot.push({ name: sky.name, tsMs: ev.tsMs, from: ev.from, storedIn: ev.storedIn });
      return;
    }
    if (ev.type === "given") {
      // Not combat. An NPC handing something over is how a turn-in ends, so a Sky **reward**
      // here dates a completion. The item itself is also now held, and it lands in a bag, so it
      // goes through the ordinary loot path where the export can vouch for it.
      const sky = matchSkyItem(ev.item);
      if (sky) {
        this.skyLoot.push({ name: sky.name, tsMs: ev.tsMs, from: "quest reward" });
        if (sky.role === "reward") this.skyCompleted.push({ reward: sky.name, tsMs: ev.tsMs });
      }
      return;
    }
    if (ev.type === "who") {
      // Not combat: it must not open a fight or extend one. Names are stable, classes are
      // not — a character gains one on levelling — so the newest line simply wins.
      const key = this.keyOf(ev.name);
      this.see(key, ev.name);
      this.classes.set(key, ev.classes);
      return;
    }
    if (ev.type === "charm") {
      // Before the inactivity check below: a charm landing is not combat activity and
      // must not hold a dead fight open, but it does need the fight that is still live.
      this.applyCharm(ev);
      return;
    }
    if (ev.type === "zone") {
      // Zoning leaves all mobs behind — end the current fight immediately.
      if (this.current) this.closeFight(this.current.lastActivityMs);
      // Both halves of a transition end the fight; only the named one moves the zone, or a
      // single zoning would be counted twice and reset the stance window twice.
      if (ev.zone !== null) {
        this.totals.zones++;
        this.zone = { name: ev.zone, sinceMs: ev.tsMs };
      }
      // A charmed pet doesn't zone with you either.
      this.charmed.clear();
      this.charmedAway.clear();
      this.charmCasts = [];
      this.lastCharmOwner.clear();
      if (ev.zone !== null) this.pushMilestone(ev.tsMs, "zone", ev.zone, `Zoned into ${ev.zone}`);
      return;
    }
    if (ev.type === "progress") {
      // Progression never opens, extends, or closes a fight — it only annotates the timeline.
      this.recordProgress(ev);
      return;
    }
    this.maybeCloseForInactivity(ev.tsMs);
    if (ev.type === "heal") {
      this.recordHeal(ev.healer, ev.target, ev.amount, ev.spell, ev.tsMs, ev.crit ?? false);
      return;
    }
    switch (ev.type) {
      case "melee":
      case "spell":
      case "dot":
        this.recordDamage(ev);
        break;
      case "miss":
        this.recordMiss(ev.attacker, ev.target, ev.tsMs);
        break;
      case "death":
        this.recordDeath(ev.victim, ev.killer, ev.tsMs);
        break;
    }
  }

  endInput(): void {
    if (this.current) this.closeFight(this.current.lastActivityMs);
  }

  get stance(): StanceState {
    return { ...this.currentStances };
  }

  fights(): Fight[] {
    const states = this.current ? [...this.finished, this.current] : [...this.finished];
    return states.map((s) => this.buildFight(s));
  }

  snapshot(): {
    current: Fight | null;
    recent: FightSummary[];
    activeEncounters: EncounterView[];
    recentEncounters: EncounterView[];
    stance: StanceState;
    stanceOverview: StanceOverviewWindow[];
    encounterHistory: SelfEncounterPoint[];
    milestones: Milestone[];
    progressWindows: ProgressWindow[];
    progress: ProgressState;
    deaths: DeathReport[];
    stats: LongTermStats;
    motes: MoteStats;
    sky: SkyStats;
  } {
    // Built once and shared: the history chart and the encounter list both want them, and
    // each view carries a sparkline that is not worth computing twice per push.
    const live = this.current ? this.buildLiveEncounters(this.current) : [];
    return {
      current: this.current ? this.buildFight(this.current) : null,
      recent: this.finishedSummaries.slice(-20),
      activeEncounters: live,
      recentEncounters: this.finishedEncounters.slice(0, 5),
      stance: { ...this.currentStances },
      // A fight in progress moves the window on every blow, so the cache only serves the idle
      // case. Rebuilding costs ~146µs against a ~5/sec push rate — far cheaper than a panel
      // that disagrees with the stance pill in the topbar.
      stanceOverview: this.current ? this.buildStanceOverviews() : (this.overviewCache ??= this.buildStanceOverviews()),
      // Same reasoning as the overview: a fight in progress moves this on every blow, so the
      // cache only serves the idle case.
      encounterHistory: this.current ? this.buildEncounterHistory(live) : (this.historyCache ??= this.buildEncounterHistory()),
      milestones: [...this.milestones],
      progressWindows: (this.progressCache ??= this.buildProgressWindows()),
      progress: { ...this.progress },
      deaths: [...this.deaths],
      stats: this.buildStats(),
      motes: this.buildMoteStats(),
      sky: this.buildSkyStats(),
    };
  }

  /** Point the Sky tracker at an inventory export (or clear it). The engine does no file IO of
   *  its own — the app reads and re-reads the file — so this is the whole of the baseline's
   *  path into the state, and re-calling it with a newer export is how a re-baseline happens. */
  setInventory(inv: Inventory | null, expectedPath: string | null = null): void {
    this.inventory = inv;
    this.inventoryExpectedPath = inv?.path ?? expectedPath;
  }

  // --- progression --------------------------------------------------------

  private recordProgress(ev: ProgressEvent): void {
    switch (ev.kind) {
      case "level":
        this.progress.level = ev.value ?? this.progress.level;
        this.pushAnchor(this.levelAnchors, `level ${ev.value}`, ev.tsMs, LEVEL_SPANS);
        this.pushMilestone(ev.tsMs, "level", `Lv ${ev.value}`, `Gained a level — now level ${ev.value}`, ev.value);
        break;
      case "ap":
        this.progress.aaUnspent = ev.total ?? this.progress.aaUnspent;
        this.pushAnchor(this.aaAnchors, `+${ev.value} AA`, ev.tsMs, AA_SPANS);
        this.pushMilestone(
          ev.tsMs,
          "ap",
          `+${ev.value} AA`,
          `Gained ${ev.value} Alternate Advancement — ${ev.total} unspent`,
          ev.value,
        );
        break;
      case "ability": {
        const named = ev.rank && ev.rank > 1 ? `${ev.name} ${ev.rank}` : ev.name ?? "ability";
        const cost = ev.value ? `${ev.value} AA` : "free";
        this.pushMilestone(ev.tsMs, "ability", named, `Trained ${named} (${cost})`);
        break;
      }
      case "unlock":
        this.pushMilestone(ev.tsMs, "ability", ev.name ?? "skill", `Learned to use ${ev.name}`);
        break;
      case "skill":
      case "xp":
        this.progressLog.push({ ts: ev.tsMs, kind: ev.kind, value: ev.value ?? 0 });
        if (this.progressLog.length > 4000) this.progressLog.shift();
        this.progressCache = null;
        break;
    }
  }

  /** The running totals as they stand right now, including the fight still open — a level
   *  earned mid-pull should not have that pull's seconds land on the *next* stretch. */
  private snapCounters(): { kills: number; zones: number; combatMs: number } {
    return {
      kills: this.totals.kills,
      zones: this.totals.zones,
      combatMs: this.totals.combatMs + this.openFightMs(),
    };
  }

  private openFightMs(): number {
    const f = this.current;
    return f ? Math.max(0, f.lastActivityMs - f.startMs) : 0;
  }

  private pushAnchor(into: Anchor[], label: string, tsMs: number, spans: number): void {
    into.unshift({ label, tsMs, zone: this.zone?.name ?? null, ...this.snapCounters() });
    // One more than the spans shown: the oldest anchor is the *start* of the oldest span.
    if (into.length > spans + 1) into.length = spans + 1;
  }

  /** The stretches between consecutive anchors, newest first, with the still-running one at
   *  the head. A completed row is labelled by the milestone that *ended* it, so it reads as
   *  "this is what that level cost" rather than "everything since it". */
  private spans(anchors: Anchor[], shown: number): MilestoneSpan[] {
    const now = this.snapCounters();
    const between = (to: { kills: number; zones: number; combatMs: number }, from: Anchor | undefined) => ({
      kills: to.kills - (from?.kills ?? 0),
      zones: to.zones - (from?.zones ?? 0),
      combatSec: Math.round((to.combatMs - (from?.combatMs ?? 0)) / 1000),
    });
    const head = anchors[0];
    // With no anchor at all, the open stretch is simply the whole session so far.
    const out: MilestoneSpan[] = [
      { label: head ? `since ${head.label}` : "this session", tsMs: null, open: true, ...between(now, head) },
    ];
    for (let i = 0; i < Math.min(shown, anchors.length); i++) {
      const a = anchors[i]!;
      // The oldest retained anchor has nothing before it, so its span would be a total rather
      // than a delta — drop it instead of printing a number that means something else.
      if (i + 1 >= anchors.length) break;
      out.push({ label: a.label, tsMs: a.tsMs, zone: a.zone, ...between(a, anchors[i + 1]) });
    }
    return out;
  }

  /** Seconds in each stance of each dimension since I last entered the zone I am in now. */
  private zoneStance(): ZoneStance {
    const from = this.zone?.sinceMs ?? null;
    // Wall-clock, not last-combat-activity: time spent standing in a stance between pulls is
    // still time in that stance, and anchoring to the last blow would freeze the tally while
    // you are alive and doing nothing, which is exactly when you might be checking it.
    const to = Math.max(from ?? 0, this.now());
    const forDim = (dim: StanceDim) => {
      const out = new Map<string, number>();
      if (from === null) return [];
      for (const seg of this.stanceSegments[dim]) {
        const s = Math.max(seg.startMs, from);
        const e = Math.min(seg.endMs ?? to, to);
        if (e > s) out.set(seg.stance, (out.get(seg.stance) ?? 0) + (e - s) / 1000);
      }
      return [...out]
        .map(([stance, seconds]) => ({ stance, seconds: Math.round(seconds) }))
        .filter((r) => r.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds);
    };
    return { zone: this.zone?.name ?? null, sinceMs: from, melee: forDim("melee"), invocation: forDim("invocation") };
  }

  /** How many of a tier's most recent drops the gap is averaged over, and the fewest it will
   *  report a number from. Below the floor the table shows the sample count instead: three
   *  drops of a rare tier is not a rate, and printing one would invite reading it as one. */
  private static readonly MOTE_GAP_WINDOW = 10;
  private static readonly MOTE_GAP_MIN = 5;
  /** Loots the difficulty grid covers. Wide enough that a rare tier still has a shape in it —
   *  at 100 the Major row was two cells and read as noise rather than a distribution. */
  private static readonly MOTE_GRID_WINDOW = 250;
  /** How many recent drops are listed above the table, newest first. */
  private static readonly MOTE_RECENT = 8;

  private recordMote(tier: MoteTier, from: string, tsMs: number): void {
    const zone = this.zone?.name ?? null;
    this.moteRecent.push({ tier, tsMs, from, zone, difficulty: zoneDifficulty(zone) });
    if (this.moteRecent.length > Engine.MOTE_GRID_WINDOW) this.moteRecent.shift();

    const at = this.moteByTier.get(tier) ?? { at: [], total: 0, from };
    at.at.push(tsMs);
    if (at.at.length > Engine.MOTE_GAP_WINDOW) at.at.shift();
    at.total++;
    at.from = from;
    this.moteByTier.set(tier, at);
  }

  private buildMoteStats(): MoteStats {
    const tiers: MoteTierStat[] = MOTE_TIERS.map((tier) => {
      const at = this.moteByTier.get(tier);
      // n drops give n-1 gaps, so the mean is simply the span divided by the gap count.
      const span = at && at.at.length > 1 ? at.at[at.at.length - 1]! - at.at[0]! : 0;
      const gaps = at ? at.at.length - 1 : 0;
      return {
        tier,
        label: moteLabel(tier),
        total: at?.total ?? 0,
        lastMs: at ? at.at[at.at.length - 1]! : null,
        lastFrom: at?.from ?? null,
        avgGapSec: at && at.at.length >= Engine.MOTE_GAP_MIN ? Math.round(span / gaps / 1000) : null,
        samples: at?.at.length ?? 0,
      };
    });

    const grid = MOTE_TIERS.map(() => [0, 0, 0, 0, 0]);
    const perDifficulty = [0, 0, 0, 0, 0];
    let unknownZone = 0;
    for (const m of this.moteRecent) {
      if (m.difficulty === null) {
        unknownZone++;
        continue;
      }
      grid[MOTE_TIERS.indexOf(m.tier)]![m.difficulty]! += 1;
      perDifficulty[m.difficulty]! += 1;
    }
    // Newest first, and off the same buffer the grid uses — a separate log would be a second
    // thing to keep in step for a handful of rows.
    const recent = this.moteRecent
      .slice(-Engine.MOTE_RECENT)
      .reverse()
      .map((m) => ({
        tier: m.tier,
        label: moteLabel(m.tier),
        tsMs: m.tsMs,
        from: m.from,
        zone: m.zone,
        difficulty: m.difficulty,
      }));
    return { tiers, grid, perDifficulty, unknownZone, windowSize: this.moteRecent.length, recent };
  }

  /** How many recent Sky pickups the panel lists. */
  private static readonly SKY_RECENT = 10;

  /** Fold the inventory export and the log into one "what do I hold" answer.
   *
   *  The two halves meet at the export's mtime and must not overlap: the export already counts
   *  everything looted before it was written, so replaying the whole log and adding every Sky
   *  pickup on top would double every item the player already had. Only pickups *after* the
   *  baseline are added. With no export at all the baseline is empty and the log supplies
   *  everything it has seen this session, which is the best that can be known. */
  private buildSkyStats(): SkyStats {
    const inv = this.inventory;
    const since = inv?.modifiedMs ?? -Infinity;

    const counts = new Map<string, { count: number; fromInventory: boolean; fromLoot: boolean }>();
    if (inv) {
      for (const [key, count] of inv.counts) {
        const ref = matchSkyItem(key);
        if (!ref) continue;
        counts.set(ref.name, { count, fromInventory: true, fromLoot: false });
      }
    }

    const recentLoot: SkyStats["recentLoot"] = [];
    for (const l of this.skyLoot) {
      // The cut-off exists to stop the export and the log counting the same pickup twice. An
      // item routed somewhere the export does not list cannot be counted twice, so applying it
      // there would only lose the item — permanently, since nothing else would ever restore it.
      if (l.tsMs <= since && !isUnexportedStorage(l.storedIn)) continue;
      const entry = counts.get(l.name);
      if (entry) {
        entry.count += 1;
        entry.fromLoot = true;
      } else {
        counts.set(l.name, { count: 1, fromInventory: false, fromLoot: true });
      }
      recentLoot.push({ name: l.name, tsMs: l.tsMs, from: l.from, storedIn: l.storedIn });
    }
    recentLoot.reverse();

    const held: SkyHolding[] = [...counts].map(([name, c]) => ({
      name,
      count: c.count,
      source: c.fromInventory && c.fromLoot ? "both" : c.fromInventory ? "inventory" : "loot",
    }));

    return {
      // The path is what the *active log* implies, so it is reported whether or not the file
      // exists; `inventoryMs` is the one that says whether it was actually read.
      inventoryPath: inv?.path ?? this.inventoryExpectedPath,
      inventoryMs: inv?.modifiedMs ?? null,
      inventoryItems: inv?.itemCount ?? 0,
      held,
      recentLoot: recentLoot.slice(0, Engine.SKY_RECENT),
      completed: [...this.skyCompleted].reverse().slice(0, Engine.SKY_RECENT),
    };
  }

  private buildStats(): LongTermStats {
    return {
      levels: this.spans(this.levelAnchors, LEVEL_SPANS),
      aa: this.spans(this.aaAnchors, AA_SPANS),
      zoneStance: this.zoneStance(),
    };
  }

  private pushMilestone(
    tsMs: number,
    kind: MilestoneKind,
    label: string,
    detail: string,
    value?: number,
  ): void {
    this.milestones.push({
      id: `ms-${++this.milestoneSeq}`,
      kind,
      tsMs,
      label,
      detail,
      ...(value === undefined ? {} : { value }),
    });
    if (this.milestones.length > 120) this.milestones.shift();
    this.progressCache = null;
  }

  /** Progression totals over the same encounter windows the stance overview uses. */
  private buildProgressWindows(): ProgressWindow[] {
    return [10, 25, 50].map((n) => {
      const encs = this.finishedEncounters.slice(0, n);
      const w: ProgressWindow = { n, levels: 0, aaGained: 0, abilities: 0, skillUps: 0, xpPct: 0, deaths: 0 };
      if (encs.length === 0) return w;
      // Everything from the oldest encounter in the window onward, so progression that
      // landed after the last kill (the level-up you just dinged) still counts.
      const from = encs[encs.length - 1]!.startMs;
      for (const m of this.milestones) {
        if (m.tsMs < from) continue;
        if (m.kind === "level") w.levels++;
        else if (m.kind === "ap") w.aaGained += m.value ?? 0;
        else if (m.kind === "ability") w.abilities++;
        else if (m.kind === "death") w.deaths++;
      }
      for (const p of this.progressLog) {
        if (p.ts < from) continue;
        if (p.kind === "skill") w.skillUps++;
        else w.xpPct += p.value;
      }
      w.xpPct = Math.round(w.xpPct * 10) / 10;
      return w;
    });
  }

  /** My per-encounter damage/tanking for the last 50 finished encounters, newest first,
   *  each tagged with the stance combo I spent the most time in during it. */
  /** @param live encounters still running, newest-first ahead of the finished ones — without
   *  them the chart cannot show the fight you are in, so a stance changed mid-boss doesn't
   *  appear until the boss dies. One guard: a live encounter joins only once it has
   *  `LIVE_POINT_MIN_SEC` behind it. A rate over one or two seconds is mostly noise, and since
   *  each half of the chart is scaled to its own peak, a single early crit would rescale every
   *  other bar on the way past. */
  private buildEncounterHistory(live: EncounterView[] = []): SelfEncounterPoint[] {
    const pool = [
      ...live.filter((e) => e.durationSec >= LIVE_POINT_MIN_SEC),
      ...this.finishedEncounters,
    ].slice(0, 50);
    return pool.map((e) => {
      const self = e.cards.find((c) => c.isSelf);
      const { melee, invocation } = this.dominantComboIn(e.startMs, e.endMs);
      const damage = self?.damage.total ?? 0;
      const taken = self?.taken.total ?? 0;
      // Both rates divide by the encounter's own length, deliberately *not* by my active
      // window inside it (`card.damage.perSec`, which the encounter table shows): joining
      // a fight for its last 6 seconds would otherwise plot as my best encounter ever.
      // Dividing by the same durationSec the client receives also makes the chart's average
      // line exactly the duration-weighted mean of the bars it crosses. (It is always ≥ 1:
      // `encounterView` rounds a span that is itself clamped to a second.)
      const secs = e.durationSec;
      return {
        id: e.id,
        name: e.name,
        startMs: e.startMs,
        endMs: e.endMs,
        durationSec: e.durationSec,
        damage,
        dps: Math.round(damage / secs),
        taken,
        takenPerSec: Math.round(taken / secs),
        melee,
        invocation,
      };
    });
  }

  /** The combo I spent the most time in over [startMs, endMs], split into its two dimensions. */
  private dominantComboIn(startMs: number, endMs: number): { melee: string; invocation: string } {
    let combo = "";
    let bestSec = -1;
    for (const [c, sec] of this.comboSecondsIn(startMs, endMs)) {
      if (sec > bestSec) [combo, bestSec] = [c, sec];
    }
    const [melee, invocation] = combo.split("|");
    return { melee: melee || "none", invocation: invocation || "none" };
  }

  /** Seconds spent in each stance combo within [startMs, endMs] (incl. the open segment). */
  private comboSecondsIn(startMs: number, endMs: number): Map<string, number> {
    const out = new Map<string, number>();
    // Walk the closed segments plus the still-open one without copying the array — this runs
    // once per encounter when the history is rebuilt, and once per merged window per overview.
    // Per-*bucket* callers must use `comboPerBucket` instead, which does all buckets in one
    // walk; calling this in a loop is what makes it quadratic in a long session.
    const add = (seg: { startMs: number; endMs: number; combo: string }) => {
      const s = Math.max(seg.startMs, startMs);
      const e = Math.min(seg.endMs, endMs);
      if (e <= s) return;
      out.set(seg.combo, (out.get(seg.combo) ?? 0) + (e - s) / 1000);
    };
    for (const seg of this.comboSegments) add(seg);
    add({ startMs: this.comboStartMs, endMs, combo: this.combo() });
    return out;
  }

  /** The dominant combo for each of `count` buckets, in **one** pass over the segments.
   *
   *  The obvious form — `dominantComboIn` per bucket — walks the whole segment list 40 times
   *  per encounter, on every snapshot, and `comboSegments` grows for the length of the
   *  session. Segments are few and buckets are many, so it is cheaper to push each segment
   *  into the buckets it covers than to ask each bucket which segments cover it. */
  private comboPerBucket(startMs: number, endMs: number, bucketMs: number, count: number): string[] {
    const perBucket: Array<Map<string, number>> = Array.from({ length: count }, () => new Map());
    const add = (seg: { startMs: number; endMs: number; combo: string }) => {
      const s = Math.max(seg.startMs, startMs);
      const e = Math.min(seg.endMs, endMs);
      if (e <= s) return;
      const first = Math.max(0, Math.floor((s - startMs) / bucketMs));
      const last = Math.min(count - 1, Math.floor((e - startMs) / bucketMs));
      for (let i = first; i <= last; i++) {
        const overlap =
          Math.min(e, startMs + (i + 1) * bucketMs) - Math.max(s, startMs + i * bucketMs);
        if (overlap <= 0) continue;
        const m = perBucket[i]!;
        m.set(seg.combo, (m.get(seg.combo) ?? 0) + overlap);
      }
    };
    for (const seg of this.comboSegments) add(seg);
    add({ startMs: this.comboStartMs, endMs, combo: this.combo() });
    return perBucket.map((m) => {
      let best = "none|none";
      let bestMs = -1;
      for (const [combo, ms] of m) if (ms > bestMs) [best, bestMs] = [combo, ms];
      return best;
    });
  }

  private buildStanceOverviews(): StanceOverviewWindow[] {
    return [10, 25, 50].map((n) => this.overviewForWindow(n));
  }

  /** The spans of the encounters running *right now*, for the overview to include alongside
   *  the finished ones. Without these the panel cannot see the fight you are in: it would
   *  report the combo you were in during the last mob that died, which on a long fight is
   *  minutes out of date and, after a stance change, simply wrong. Each mob's own
   *  first-contact → last-blow window, so it stays combat time rather than the fight's span. */
  private liveSpans(): Array<[number, number]> {
    const f = this.current;
    if (!f) return [];
    const out: Array<[number, number]> = [];
    for (const key of f.perTarget.keys()) {
      const from = f.firstSeen.get(key);
      const to = f.lastSeen.get(key);
      if (from !== undefined && to !== undefined) out.push([from, Math.max(to, from + 1000)]);
    }
    return out;
  }

  /** Average self DPS per stance+invocation combo over the last N encounters, the one in
   *  progress included. */
  private overviewForWindow(n: number): StanceOverviewWindow {
    const encs = this.finishedEncounters.slice(0, n);
    const live = this.liveSpans();
    if (encs.length === 0 && live.length === 0) return { n, rows: [], damage: 0, seconds: 0 };

    // Merge the encounters' time windows so simultaneous mobs aren't double-counted. Each is
    // clamped to a second first: a mob I one-shot is first seen and slain within the same log
    // second, so its raw interval is zero-width — it would contribute its damage to the window
    // with no seconds behind it and inflate every rate divided by them. `durationSec` already
    // credits that encounter one second; this is the same clamp, kept in step with it.
    const merged: Array<[number, number]> = [];
    for (const iv of [...encs.map((e): [number, number] => [e.startMs, Math.max(e.endMs, e.startMs + 1000)]), ...live]
      .sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    const blank = () => ({ damage: 0, taken: 0, seconds: 0 });
    const agg = new Map<string, ReturnType<typeof blank>>();
    const bump = (combo: string, field: "damage" | "taken" | "seconds", amount: number) => {
      const a = agg.get(combo) ?? blank();
      a[field] += amount;
      agg.set(combo, a);
    };
    for (const [s, e] of merged) {
      for (const [combo, sec] of this.comboSecondsIn(s, e)) bump(combo, "seconds", sec);
    }

    // Both combo logs are chronological and `merged` is sorted and disjoint, so one pointer
    // walks a log against the windows — O(entries + windows) instead of testing every entry
    // against every window. This is the engine's most expensive rebuild and it happens on
    // every kill, so the difference is worth the pointer. Bisecting to the first entry inside
    // the window also keeps a 10-encounter window from paying for a 50-encounter-deep log.
    const sweep = (log: ReadonlyArray<{ combo: string; amount: number; ts: number }>, field: "damage" | "taken") => {
      let iv = 0;
      for (let i = lowerBound(log, merged[0]![0]); i < log.length; i++) {
        const ent = log[i]!;
        while (iv < merged.length && merged[iv]![1] < ent.ts) iv++;
        if (iv === merged.length) return; // past the last window — so is the rest of the log
        if (ent.ts < merged[iv]![0]) continue; // fell in a gap between two windows
        bump(ent.combo, field, ent.amount);
      }
    };
    sweep(this.selfComboLog, "damage");
    sweep(this.selfTakenComboLog, "taken");

    // Window totals come from `agg` *before* the zero-damage rows are dropped below: a combo
    // I stood in without swinging still spent real seconds, and leaving them out would inflate
    // the headline rate. These merged seconds count wall-clock once even when two mobs overlap.
    let windowSec = 0;
    let windowDmg = 0;
    for (const v of agg.values()) {
      windowSec += v.seconds;
      windowDmg += v.damage;
    }
    const rows = [...agg.entries()]
      .map(([combo, v]) => {
        const [melee = "none", invocation = "none"] = combo.split("|");
        const seconds = Math.max(1, v.seconds);
        return {
          melee,
          invocation,
          damage: v.damage,
          taken: v.taken,
          seconds: Math.round(v.seconds),
          dps: Math.round(v.damage / seconds),
          takenPerSec: Math.round(v.taken / seconds),
          timeShare: windowSec > 0 ? Math.round((v.seconds / windowSec) * 100) : 0,
        };
      })
      .filter((r) => r.damage > 0)
      .sort((a, b) => b.dps - a.dps);
    return { n, rows, damage: windowDmg, seconds: Math.round(windowSec) };
  }

  // --- stances ------------------------------------------------------------

  private applyStance(tsMs: number, dim: StanceDim, stance: string): void {
    // Close the current combined-stance segment, then start a new one.
    if (tsMs > this.comboStartMs) this.comboSegments.push({ startMs: this.comboStartMs, endMs: tsMs, combo: this.combo() });
    this.comboStartMs = tsMs;

    const segs = this.stanceSegments[dim];
    const last = segs[segs.length - 1];
    if (last && last.endMs === null) last.endMs = tsMs;
    segs.push({ startMs: tsMs, endMs: null, stance });
    this.currentStances[dim] = stance;
  }

  private combo(): string {
    return `${this.currentStances.melee}|${this.currentStances.invocation}`;
  }

  // --- charm --------------------------------------------------------------

  private applyCharm(ev: CharmEvent): void {
    if (ev.state === "cast") {
      const casterKey = this.keyOf(ev.who);
      // Register the spelling too: a charmer who only ever appears on a cast line would
      // otherwise be credited under its lowercased key ("phatez") on the pet's row.
      this.see(casterKey, ev.who);
      this.charmCasts.push({ casterKey, spell: ev.spell ?? "", ts: ev.tsMs });
      const seen = this.charmCasters.get(casterKey);
      if (seen) (seen.casts++, (seen.lastTs = ev.tsMs));
      else this.charmCasters.set(casterKey, { casts: 1, lastTs: ev.tsMs });
      this.trimCharmCasts(ev.tsMs);
      return;
    }
    if (ev.state === "off") {
      // An empty `who` is a song ending: it breaks every charm that song is holding.
      if (ev.who) {
        const key = this.keyOf(ev.who);
        this.charmedAway.delete(key); // one of ours, handed back
        this.breakCharm(key);
        this.breakCharm(twinKey(key)); // it may have been split off from its namesake
      } else {
        for (const [key, hold] of [...this.charmed]) {
          if (hold.spell === ev.spell) this.breakCharm(key);
        }
      }
      return;
    }

    const key = this.keyOf(ev.who);
    this.see(key, ev.who);
    this.current?.everCharmed.add(key);
    const held = this.charmed.get(key);
    if (held) {
      // A bard's song re-lands on every pulse. That is the same pet, not a new one —
      // re-splitting its encounter here would shred the fight into one-tick slivers.
      // A later pulse can still name the owner an earlier one missed.
      if (held.ownerKey === null) Object.assign(held, this.resolveCharmOwner(ev, key, this.current));
      return;
    }

    const f = this.current;
    if (f) {
      const { friendly, npc } = this.resolveKinds(f);
      // Charm flips allegiance, so landing on one of *ours* is the opposite event: they
      // become the enemy, not our pet. A mob being charmed is an enemy at this instant, so
      // "already friendly" is what separates the two cases.
      if (friendly.has(key) && key !== this.selfKey && !isTwinKey(key)) {
        this.charmedAway.add(key);
        f.npcSeeds.add(key);
        return;
      }
      // The mob was an enemy until this instant. Bank what it did and what was done to
      // it as a finished encounter, then wipe its tracking, so the pet's row starts from
      // zero instead of inheriting the health bar we just chewed through. This is the
      // same reset a death does, for the same reason: one name, two separate lives.
      if (npc.has(key)) {
        this.pushEncounter(f, key, ev.tsMs, friendly);
        this.resetNpcTracking(f, key, friendly);
      }
      f.npcSeeds.delete(key);
      // Stop it holding the fight open: an un-killed pet would otherwise keep the
      // engaged set non-empty until the inactivity timeout.
      f.aliveEngaged.delete(key);
    }
    this.charmed.set(key, {
      ...this.resolveCharmOwner(ev, key, f),
      spell: ev.spell ?? null,
      sinceMs: ev.tsMs,
    });
  }

  /** Who owns this charm, by the strongest evidence available, remembering the answer so a
   *  charm that flickers off and back doesn't lose an attribution we already earned. */
  private resolveCharmOwner(
    ev: CharmEvent,
    key: string,
    f: FightState | null,
  ): { ownerKey: string | null; ownerGuess: boolean } {
    // A matched cast is the stronger evidence and wins; the class inference is the fallback
    // for the charms nobody's cast line announced.
    const cast = this.charmOwner(ev.tsMs);
    const byClass = cast || !ev.emote ? null : this.charmOwnerByClass(ev.emote, f);
    const ownerKey = cast ?? byClass?.key ?? null;
    const ownerGuess = byClass?.guess ?? false;
    if (ownerKey) this.lastCharmOwner.set(key, { ownerKey, guess: ownerGuess });
    return { ownerKey, ownerGuess };
  }

  private trimCharmCasts(tsMs: number): void {
    let drop = 0;
    while (drop < this.charmCasts.length && tsMs - this.charmCasts[drop]!.ts > CHARM_ATTRIB_MS) drop++;
    if (drop > 0) this.charmCasts.splice(0, drop);
  }

  /** The most recent charm cast still inside the attribution window, if any. */
  private charmOwner(tsMs: number): string | null {
    this.trimCharmCasts(tsMs);
    const last = this.charmCasts[this.charmCasts.length - 1];
    return last && tsMs >= last.ts ? last.casterKey : null;
  }

  /** Who, of the people actually in this fight, could have cast the charm that made this
   *  emote. The message identifies the spell (`spells.ts`), the spell identifies the class,
   *  and `/who` gives us classes — so "a mob has been charmed" in a group holding exactly
   *  one enchanter names that enchanter.
   *
   *  With more than one candidate it still answers, but says so: `guess` marks the name as a
   *  best effort rather than a deduction, and the card passes that on. Ranking is by evidence,
   *  not by luck — whoever has been *seen casting* a charm this session comes first, and among
   *  equals the one who cast most recently. Someone who has actually charmed in front of us is
   *  a better bet than a groupmate who merely has the class.
   *
   *  Only ever consulted when no charm *cast* matched, which is the common case for another
   *  player's charm — their cast line is usually not echoed to our log at all. */
  private charmOwnerByClass(
    emote: CharmEmoteKind,
    f: FightState | null,
  ): { key: string; guess: boolean } | null {
    const casters = CHARM_EMOTES[emote]?.casters;
    if (!casters || !f) return null;
    const candidates: string[] = [];
    for (const key of f.combatants.keys()) {
      const cls = this.classes.get(key);
      if (cls?.some((c) => casters.includes(c as ClassCode))) candidates.push(key);
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return { key: candidates[0]!, guess: false };
    const rank = (k: string) => this.charmCasters.get(k) ?? { casts: 0, lastTs: 0 };
    const best = candidates.reduce((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra.casts !== rb.casts) return rb.casts > ra.casts ? b : a;
      return rb.lastTs > ra.lastTs ? b : a;
    });
    return { key: best, guess: true };
  }

  /** End a charm: the mob is an enemy again, so its pet-era tracking is wiped and the
   *  next blow it trades opens a fresh encounter. Its damage to mobs that already died
   *  is untouched — those encounters were banked when they were finalized. */
  private breakCharm(key: string): void {
    if (!this.charmed.delete(key)) return;
    // Symmetric with the reset on the charm *landing*: the mob is an enemy again, so its
    // next encounter starts clean, and what it dealt us before the charm stays banked in
    // the encounter that was closed back then rather than being counted a second time.
    // `resolveKinds` is affordable here — this runs once per actual break, not per blow.
    if (this.current) this.resetNpcTracking(this.current, key, this.resolveKinds(this.current).friendly);
  }

  /** The charm breaks that need no message — which is the only kind another player's
   *  charm ever gets, since the log announces theirs to nobody. Two signals:
   *
   *  - a pet turning on its own charmer, the classic break (real case: a greater dark
   *    bone healed by Phatez at 23:17:36, kicking him at 23:17:41);
   *  - blows traded with me in either direction, which covers a pet whose charmer we
   *    never identified — you cannot damage your own charmed pet, nor it you.
   *
   *  Both wait out the grace window, so a swing already in the air when the charm landed
   *  doesn't un-charm a pet that goes on to fight for us for the next half minute. */
  private maybeBreakCharm(aKey: string, tKey: string, tsMs: number): void {
    const broke = (key: string): boolean => {
      const held = this.charmed.get(key);
      return held !== undefined && tsMs - held.sinceMs > CHARM_GRACE_MS;
    };
    if (this.charmed.get(aKey)?.ownerKey === tKey && broke(aKey)) return this.breakCharm(aKey);
    const key = tKey === this.selfKey ? aKey : aKey === this.selfKey ? tKey : null;
    if (key !== null && key !== this.selfKey && broke(key)) this.breakCharm(key);
  }

  // --- identity -----------------------------------------------------------

  private keyOf(name: string): string {
    if (/^you$/i.test(name) || name.toLowerCase() === this.selfKey) return this.selfKey;
    return name.toLowerCase();
  }

  private see(key: string, name: string): void {
    if (key === this.selfKey) return;
    if (!this.display.has(key)) this.display.set(key, name);
  }

  private nameOf(key: string): string {
    return this.display.get(key) ?? key;
  }

  /** Two mobs, one name, opposite sides — and the log gives them the same key. **A mob never
   *  attacks itself**, so a blow with one name on both sides is proof there are two, and that
   *  proof stands on its own: it needs no charm message to back it up. The attacker is moved
   *  onto a key of its own (keeping its display name) and its namesake keeps the plain key as
   *  the enemy we are fighting.
   *
   *  A charm we already know about moves across with it. When we know of none, one is inferred
   *  here, because fighting its own kind on our side is the only way this happens — and by then
   *  a real charm has usually been *lost* rather than never seen: our swings at the enemy twin
   *  land on the shared key and read as swings at our own pet, which breaks the charm before any
   *  same-name blow can reveal the pair. That is what kept a charmed fire giant warrior out of
   *  the table entirely while it fought its namesake for a full minute.
   *
   *  Which side of such a blow is the pet cannot be known — both mobs swing, and the two lines
   *  are identical. The attacker is taken to be the pet, since that is the mob that was pointed
   *  at the other; the exchange it is credited with therefore also carries what its twin hit it
   *  back for, and the card is flagged so. */
  private splitSelfAttacker(key: string, tsMs: number): string {
    const twin = twinKey(key);
    if (this.charmed.has(twin)) return twin;
    const hold = this.charmed.get(key);
    this.charmed.delete(key);
    // No landing message reaches this path, so there is no class to infer from — but this mob
    // may already have been attributed earlier in the fight, before its charm flickered off.
    const remembered = this.lastCharmOwner.get(key) ?? this.lastCharmOwner.get(twin);
    this.charmed.set(
      twin,
      hold ?? {
        ownerKey: this.charmOwner(tsMs) ?? remembered?.ownerKey ?? null,
        ownerGuess: remembered?.guess ?? false,
        spell: null,
        sinceMs: tsMs,
      },
    );
    this.current?.everCharmed.add(twin);
    this.display.set(twin, this.nameOf(key));
    const owner = this.petOwners.get(key);
    if (owner) this.petOwners.set(twin, owner);
    return twin;
  }

  // --- fight lifecycle ----------------------------------------------------

  private openFight(tsMs: number): FightState {
    if (this.current) return this.current;
    this.current = {
      id: `fight-${++this.fightSeq}`,
      startMs: tsMs,
      endMs: null,
      lastActivityMs: tsMs,
      combatants: new Map(),
      damagePairs: [],
      healPairs: [],
      healLog: [],
      deaths: [],
      npcSeeds: new Set(),
      targetIncoming: new Map(),
      perTarget: new Map(),
      selfHits: new Map(),
      selfTaken: new Map(),
      hitsOn: new Map(),
      hitsBy: new Map(),
      pairFirst: new Map(),
      firstSeen: new Map(),
      lastSeen: new Map(),
      aliveEngaged: new Set(),
      everCharmed: new Set(),
    };
    return this.current;
  }

  private closeFight(endMs: number): void {
    if (!this.current) return;
    // Any engaged-but-unslain NPCs (a boss you fled, a zoned pull) still complete.
    this.finalizeOpenEncounters(this.current, endMs);
    this.current.endMs = endMs;
    // Fights never overlap, so their spans sum to real time in combat — unlike encounters,
    // where two mobs at once would count the same second twice.
    this.totals.combatMs += Math.max(0, endMs - this.current.startMs);
    this.finishedSummaries.push(this.summarize(this.buildFight(this.current)));
    this.finished.push(this.current);
    // Bound memory over long sessions (fights() / report still see the recent window).
    if (this.finished.length > 60) this.finished.shift();
    if (this.finishedSummaries.length > 60) this.finishedSummaries.shift();
    this.current = null;
  }

  /** Finalize every still-tracked NPC when the fight ends (a boss you fled, a zoned pull).
   *  Cap each to its last actual combat activity, not the (possibly much later) close time. */
  private finalizeOpenEncounters(f: FightState, endMs: number): void {
    const { friendly, npc } = this.resolveKinds(f);
    for (const tKey of [...f.perTarget.keys()]) {
      if (npc.has(tKey)) this.pushEncounter(f, tKey, f.lastSeen.get(tKey) ?? endMs, friendly);
    }
  }

  private maybeCloseForInactivity(tsMs: number): void {
    if (!this.current) return;
    if (tsMs - this.current.lastActivityMs > this.opts.inactivityTimeoutSec * 1000) {
      this.closeFight(this.current.lastActivityMs);
    }
  }

  // --- recording ----------------------------------------------------------

  private combatant(f: FightState, key: string): CombatantAgg {
    let c = f.combatants.get(key);
    if (!c) {
      c = {
        key,
        name: this.nameOf(key),
        done: newMetric(),
        heal: newMetric(),
        taken: newMetric(),
        stanceTotals: { melee: new Map(), invocation: new Map() },
      };
      f.combatants.set(key, c);
    }
    return c;
  }

  private recordInteraction(
    attacker: string,
    target: string,
    tsMs: number,
    /** Whether this blow is evidence a charm broke. A DoT cast before the charm keeps
     *  ticking on the mob for its full duration afterwards — that is residue, not a
     *  fresh decision to attack, and reading it as a break un-charms a healthy pet a
     *  few seconds in. Real breaks always bring melee or a nuke with them. */
    breaksCharm = true,
  ): { f: FightState; aKey: string; tKey: string } {
    const f = this.openFight(tsMs);
    f.lastActivityMs = tsMs;
    let aKey = this.keyOf(attacker);
    const tKey = this.keyOf(target);
    this.see(aKey, attacker);
    this.see(tKey, target);
    // A mob left alone for a minute is a finished engagement; whatever comes next is a new
    // one, not a continuation. Reset it before `lastSeen` is updated below, so the stale
    // stretch is dropped rather than stretched over the gap. Only mobs qualify — resetting a
    // groupmate would discard the damage they had taken — and `resolveKinds` is affordable
    // because this fires only on the rare re-engagement, not on every blow.
    for (const key of aKey === tKey ? [aKey] : [aKey, tKey]) {
      if (key === this.selfKey || !f.npcSeeds.has(key)) continue;
      const last = f.lastSeen.get(key);
      if (last !== undefined && tsMs - last > ENCOUNTER_IDLE_SEC * 1000) {
        this.resetNpcTracking(f, key, this.resolveKinds(f).friendly);
      }
    }
    // Nothing attacks itself, so one name on both sides of a blow means two mobs wearing it.
    // Split the attacker off here and the rest of the engine treats them as the two entities
    // they are: the pet earns its own encounter row, and our swings at its namesake stop
    // reading as swings at our own pet.
    if (aKey === tKey) aKey = this.splitSelfAttacker(aKey, tsMs);
    // Before the NPC seeding below, so a pet that just broke loose is seeded as the
    // enemy it now is rather than being held friendly by a stale charm.
    if (breaksCharm) this.maybeBreakCharm(aKey, tKey, tsMs);
    // A blow from a pet still inside its grace window is pre-charm aggression that merely
    // landed late, so it is no evidence of anyone's faction. `damagePairs` feeds only the
    // classifier, so dropping it costs no damage accounting. (Real case: a wan ghoul knight
    // glazed at 03:35:56 and struck the player Hugh at 03:35:57 — without this, Hugh reads
    // as a mob the group is fighting. Its blows after the window classify as normal, which
    // is what still identifies the mobs a pet is genuinely sent at.)
    const settling = this.charmed.get(aKey);
    if (!settling || tsMs - settling.sinceMs > CHARM_GRACE_MS) f.damagePairs.push([aKey, tKey]);
    const pk = `${aKey}>${tKey}`;
    if (!f.pairFirst.has(pk)) f.pairFirst.set(pk, tsMs); // first attack/contact (hit or miss)
    if (!f.firstSeen.has(aKey)) f.firstSeen.set(aKey, tsMs);
    if (!f.firstSeen.has(tKey)) f.firstSeen.set(tKey, tsMs);
    f.lastSeen.set(aKey, tsMs);
    f.lastSeen.set(tKey, tsMs);
    if (aKey === this.selfKey && tKey !== this.selfKey) {
      f.npcSeeds.add(tKey);
      f.aliveEngaged.add(tKey);
    }
    if (tKey === this.selfKey && aKey !== this.selfKey) {
      f.npcSeeds.add(aKey);
      f.aliveEngaged.add(aKey);
    }
    return { f, aKey, tKey };
  }

  private recordDamage(ev: Extract<CombatEvent, { type: "melee" | "spell" | "dot" }>): void {
    const attacker = ev.type === "melee" ? ev.attacker : ev.type === "spell" ? ev.owner : ev.caster;
    const { f, aKey, tKey } = this.recordInteraction(attacker, ev.target, ev.tsMs, ev.type !== "dot");

    const inc = f.targetIncoming.get(tKey) ?? { name: this.nameOf(tKey), total: 0 };
    inc.total += ev.amount;
    f.targetIncoming.set(tKey, inc);

    const abilityName = ev.type === "melee" ? ev.verb : ev.type === "spell" ? ev.effect : ev.spell;
    // Every damage form that can crit says so the same way — a "(Critical)" after the
    // terminator. Only the "non-melee" proc line never carries one, so its `crit` is absent
    // rather than false-by-omission.
    const crit = ev.crit ?? false;

    addAbility(this.combatant(f, aKey).done, abilityName, ev.type, ev.amount, crit);
    addAbility(this.combatant(f, tKey).taken, abilityName, ev.type, ev.amount, false);

    // Per-target attacker breakdown (for per-NPC encounters + cards).
    let byAttacker = f.perTarget.get(tKey);
    if (!byAttacker) {
      byAttacker = new Map();
      f.perTarget.set(tKey, byAttacker);
    }
    let cell = byAttacker.get(aKey);
    if (!cell) {
      cell = newMetric();
      byAttacker.set(aKey, cell);
    }
    addAbility(cell, abilityName, ev.type, ev.amount, crit);

    // Every blow, from both ends, so the mob's half of the timeline can show the whole group's
    // damage rather than only mine. Cleared with the mob's other tracking on reset. The self is
    // skipped: it can never be an encounter's subject, so its logs would only ever grow — and on
    // a long fight they are the two that grow fastest.
    if (tKey !== this.selfKey) pushHit(f.hitsOn, tKey, ev.tsMs, ev.amount);
    if (aKey !== this.selfKey) pushHit(f.hitsBy, aKey, ev.tsMs, ev.amount);

    if (aKey === this.selfKey) {
      const c = this.combatant(f, aKey);
      for (const dim of STANCE_DIMS) {
        const s = this.currentStances[dim];
        c.stanceTotals[dim].set(s, (c.stanceTotals[dim].get(s) ?? 0) + ev.amount);
      }
      this.selfComboLog.push({ combo: this.combo(), amount: ev.amount, ts: ev.tsMs });
      // Timestamped per *target*, which `selfComboLog` is not: the encounter sparkline has to
      // be my damage to this mob alone, or it would disagree with the row above it whenever
      // two mobs are up. Dropped with the mob's other tracking when it dies.
      pushHit(f.selfHits, tKey, ev.tsMs, ev.amount);
    }
    if (tKey === this.selfKey && aKey !== this.selfKey) {
      this.selfTakenComboLog.push({ combo: this.combo(), amount: ev.amount, ts: ev.tsMs });
      // Per-mob and timestamped, so an encounter's strip can show what *this* mob did to me.
      pushHit(f.selfTaken, aKey, ev.tsMs, ev.amount);
      // …and once more with the attacker and ability, which the two logs above both drop.
      // Only a death reads this, and only the last few seconds of it.
      this.selfBlows.push({
        tsMs: ev.tsMs,
        attacker: this.nameOf(aKey),
        ability: abilityName,
        amount: ev.amount,
        damageType: ev.type,
        crit,
      });
      this.trimDeathWindow(ev.tsMs);
    }
  }

  /** Drop blows and heals that no future death report could reach back for. */
  private trimDeathWindow(nowMs: number): void {
    const cutoff = nowMs - DEATH_WINDOW_SEC * 1000;
    let drop = 0;
    while (drop < this.selfBlows.length && this.selfBlows[drop]!.tsMs < cutoff) drop++;
    if (drop > 0) this.selfBlows.splice(0, drop);
    drop = 0;
    while (drop < this.selfHealsIn.length && this.selfHealsIn[drop]!.tsMs < cutoff) drop++;
    if (drop > 0) this.selfHealsIn.splice(0, drop);
  }

  /** Assemble "what killed me" from the rolling window. Everything here was already in the
   *  event stream; the only thing this adds is keeping it together long enough to read. */
  private recordDeathReport(tsMs: number, killer: string): void {
    const from = tsMs - DEATH_WINDOW_SEC * 1000;
    // A blow landing on the same second as the death still counts — the log's resolution is
    // one second, so the killing blow usually shares its timestamp with the death line.
    const blows = this.selfBlows.filter((b) => b.tsMs >= from && b.tsMs <= tsMs);
    const sum = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
    const byAttacker = new Map<string, number>();
    const byAbility = new Map<string, number>();
    const abilityType = new Map<string, DamageType>();
    for (const b of blows) {
      sum(byAttacker, b.attacker, b.amount);
      sum(byAbility, b.ability, b.amount);
      abilityType.set(b.ability, b.damageType);
    }
    const rank = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
    const { melee, invocation } = this.currentStances;
    this.deaths.unshift({
      id: `death-${++this.deathSeq}`,
      tsMs,
      killer,
      windowSec: DEATH_WINDOW_SEC,
      totalTaken: blows.reduce((n, b) => n + b.amount, 0),
      healed: this.selfHealsIn.filter((h) => h.tsMs >= from && h.tsMs <= tsMs).reduce((n, h) => n + h.amount, 0),
      blows,
      byAttacker: rank(byAttacker).map(([name, total]) => ({ name, total })),
      byAbility: rank(byAbility).map(([name, total]) => ({
        name,
        total,
        damageType: abilityType.get(name) ?? "unknown",
      })),
      melee,
      invocation,
    });
    if (this.deaths.length > 5) this.deaths.length = 5;
  }

  private recordMiss(attacker: string, target: string, tsMs: number): void {
    const { f, aKey, tKey } = this.recordInteraction(attacker, target, tsMs);
    this.combatant(f, aKey).done.avoided++;
    this.combatant(f, tKey).taken.avoided++;
  }

  private recordHeal(
    healer: string,
    target: string,
    amount: number,
    spell: string | undefined,
    tsMs: number,
    crit: boolean,
  ): void {
    // Attribute heals to an ongoing fight, but don't let healing alone keep a
    // fight alive (that would bridge separate pulls). Out-of-combat heals — where
    // the inactivity check above has already closed the fight — are ignored.
    if (!this.current) return;
    const f = this.current;
    const hKey = this.keyOf(healer);
    const tKey = this.keyOf(target);
    this.see(hKey, healer);
    this.see(tKey, target);
    f.healPairs.push([hKey, tKey]);
    f.healLog.push({ healer: hKey, amount, spell: spell ?? "Heal", tsMs });
    // Healing *on me*, for the death report: "was anyone trying" is half of why a death
    // happened, and `healLog` doesn't record the target.
    if (tKey === this.selfKey) {
      this.selfHealsIn.push({ tsMs, amount });
      this.trimDeathWindow(tsMs);
    }
    addAbility(this.combatant(f, hKey).heal, spell ?? "Heal", "unknown", amount, crit);
  }

  private recordDeath(victim: string, killer: string | null, tsMs: number): void {
    const f = this.openFight(tsMs);
    f.lastActivityMs = tsMs;
    const vKey = this.keyOf(victim);
    const kKey = killer ? this.keyOf(killer) : null;
    const killerSelf = kKey === this.selfKey;
    this.see(vKey, victim);
    if (kKey && killer) this.see(kKey, killer);
    f.deaths.push({ victim: vKey, killer: kKey, killerSelf });
    if (killerSelf) f.npcSeeds.add(vKey);
    // A charm dies with its holder. Leaving it set would hand the charm to the next
    // mob of the same name — "a lava beetle" is not a unique creature.
    this.charmed.delete(vKey);
    this.charmedAway.delete(vKey);
    // My own death is the single biggest explanation for a collapsed DPS bar — mark it, and
    // keep the run-up to it while it is still in the window.
    if (vKey === this.selfKey) {
      const by = kKey ? this.nameOf(kKey) : "something";
      this.pushMilestone(tsMs, "death", "Died", `Slain by ${by}`);
      this.recordDeathReport(tsMs, by);
    }
    // A slain NPC completes its encounter → add it to the rolling recent list.
    this.finalizeEncounter(f, vKey, tsMs);
    if (f.aliveEngaged.delete(vKey) && f.aliveEngaged.size === 0 && f.npcSeeds.size > 0) {
      this.closeFight(tsMs);
    }
  }

  /** On an NPC's death: record the completed encounter, then reset that mob's tracking so a
   *  same-named respawn is a fresh instance (fixes generic-name merging). A *friendly*
   *  death ends nothing — resetting there would erase the corpse's damage from every mob
   *  still being fought, which is exactly the run you want to keep looking at. */
  private finalizeEncounter(f: FightState, victimKey: string, deathMs: number): void {
    const { friendly, npc } = this.resolveKinds(f);
    if (!npc.has(victimKey)) return;
    this.totals.kills++;
    this.pushEncounter(f, victimKey, deathMs, friendly);
    this.resetNpcTracking(f, victimKey, friendly);
  }

  private pushEncounter(f: FightState, npcKey: string, endMs: number, friendly: Set<string>): void {
    const view = this.encounterView(f, npcKey, endMs, false, `enc-${this.encounterSeq + 1}`, friendly);
    if (!view) return;
    this.encounterSeq++;
    this.finishedEncounters.unshift(view);
    this.overviewCache = null; // a new encounter changes the stance overview
    this.historyCache = null;
    this.progressCache = null; // …and shifts the window the progression counters cover
    if (this.finishedEncounters.length > 60) this.finishedEncounters.length = 60;
    // Drop timestamped log entries older than the oldest encounter we still keep.
    const oldest = this.finishedEncounters[this.finishedEncounters.length - 1]?.startMs ?? 0;
    const trim = <T>(log: T[], tsOf: (e: T) => number): void => {
      let drop = 0;
      while (drop < log.length && tsOf(log[drop]!) < oldest) drop++;
      if (drop > 0) log.splice(0, drop);
    };
    const byTs = (e: { ts: number }) => e.ts;
    trim(this.selfComboLog, byTs);
    trim(this.selfTakenComboLog, byTs);
    trim(this.progressLog, byTs);
    trim(this.milestones, (m) => m.tsMs);
  }

  /** Clear a mob's per-encounter tracking so the next same-named mob starts fresh. */
  private resetNpcTracking(f: FightState, npcKey: string, friendly?: Set<string>): void {
    f.perTarget.delete(npcKey);
    f.selfHits.delete(npcKey);
    f.selfTaken.delete(npcKey);
    f.hitsOn.delete(npcKey);
    f.hitsBy.delete(npcKey);
    // What it dealt *out* is cleared from **friendly victims only**, so a same-named respawn's
    // `taken` on our cards starts at zero. Damage it dealt to another *mob* is pet damage,
    // banked in that mob's still-running encounter, and has to survive — this reset fires on
    // every re-charm and on every death of anything sharing the name, which over one Lord
    // Nagafen fight erased 36,439 points across 609 hits, some twenty times over. Callers on
    // the hot path pass no `friendly` set and skip this entirely: a charm merely breaking is
    // no reason to unpick where that mob's damage landed.
    if (friendly) {
      for (const [victimKey, m] of f.perTarget) if (friendly.has(victimKey)) m.delete(npcKey);
    }
    f.firstSeen.delete(npcKey);
    f.lastSeen.delete(npcKey);
    f.targetIncoming.delete(npcKey);
    for (const k of [...f.pairFirst.keys()]) {
      if (k.startsWith(`${npcKey}>`) || k.endsWith(`>${npcKey}`)) f.pairFirst.delete(k);
    }
  }

  /** Live per-NPC encounters for the current fight (mobs still being fought). */
  private buildLiveEncounters(f: FightState): EncounterView[] {
    const { friendly, npc } = this.resolveKinds(f);
    const slain = new Set(f.deaths.filter((d) => npc.has(d.victim)).map((d) => d.victim));
    const now = this.now();
    // The same window the reset above uses: a mob idle past it has no live encounter.
    const idleMs = ENCOUNTER_IDLE_SEC * 1000;
    const out: EncounterView[] = [];
    for (const tKey of f.perTarget.keys()) {
      // A mob in perTarget is always a live instance (dead ones are reset out on death),
      // so we don't consult the deaths list for the mob itself — that would wrongly hide a
      // same-named respawn. We only use it to despawn a pet whose owner is dead and gone.
      if (!npc.has(tKey)) continue;
      const ownerKey = tKey.endsWith(" pet") ? tKey.slice(0, -4) : null;
      if (ownerKey && slain.has(ownerKey) && !f.perTarget.has(ownerKey)) continue; // pet despawns with owner
      if (now - (f.lastSeen.get(tKey) ?? now) > idleMs) continue; // gone stale
      const view = this.encounterView(f, tKey, now, true, `live-${tKey}`, friendly);
      if (view) out.push(view);
    }
    return out.sort((a, b) => b.total - a.total);
  }

  /** Shared: build one per-mob encounter with per-character cards (self + top 5 by DPS). */
  private encounterView(
    f: FightState,
    npcKey: string,
    endMs: number,
    active: boolean,
    id: string,
    friendly: Set<string>,
  ): EncounterView | null {
    const attackers = f.perTarget.get(npcKey);
    if (!attackers) return null;

    // Fold pets into owners; track each owner's first contact with the NPC.
    const byOwner = new Map<string, MetricAcc>();
    const ownerFirst = new Map<string, number>();
    for (const [aKey, cell] of attackers) {
      // A charmed mob never folds: the user reads it as its own participant, and its
      // charmer may not even be in this fight. Only summoned pets collapse into an owner.
      const ownerKey = (this.charmed.has(aKey) ? undefined : this.petOwners.get(aKey)) ?? aKey;
      // `everCharmed` and not just `friendly`: a charm on a name we are *also* fighting is
      // broken and re-applied over and over, because our swings at the other mobs of that
      // name land on the shared key. The mob is therefore un-charmed for most of the fight
      // by the flag's reckoning, while plainly still fighting for us. What settles it is
      // that it is hitting a *mob*: nothing hostile has a reason to do that, so its damage
      // here is ours no matter what the flag said at the time. (A charmed fire giant warrior
      // dealt 36,439 to Lord Nagafen over 609 hits and the table showed none of it.)
      if (ownerKey !== this.selfKey && !friendly.has(ownerKey) && !f.everCharmed.has(ownerKey)) continue;
      let dst = byOwner.get(ownerKey);
      if (!dst) {
        dst = newMetric();
        byOwner.set(ownerKey, dst);
      }
      mergeAcc(dst, cell, ownerKey === aKey ? null : "🐾");
      const pf = f.pairFirst.get(`${aKey}>${npcKey}`);
      if (pf !== undefined) ownerFirst.set(ownerKey, Math.min(ownerFirst.get(ownerKey) ?? Infinity, pf));
    }
    if (byOwner.size === 0) return null;

    const startMs = f.firstSeen.get(npcKey) ?? f.startMs;
    // The encounter span is also the mob's own active window: firstSeen is its first
    // interaction with anyone, so the two whole-encounter rates below share one denominator.
    const spanSec = Math.max(1, (endMs - startMs) / 1000);
    const total = [...byOwner.values()].reduce((s, a) => s + a.total, 0);

    // What the mob dealt back, summed over every friendly it hit — the other half of the
    // header. Its outgoing cells are cleared with the rest of its tracking on death, so a
    // same-named respawn starts from zero here too. Only the total is wanted: the header
    // prints a rate, and each victim's own card already carries the same damage broken
    // down under `taken`, so merging its abilities here would ship that twice.
    let npcOut = 0;
    for (const [victimKey, byAttacker] of f.perTarget) {
      // Same reasoning as the attacker filter: a pet it mauled counts among what it dealt
      // out, even during the stretches its charm flag was off.
      if (victimKey === npcKey || !(friendly.has(victimKey) || f.everCharmed.has(victimKey))) continue;
      npcOut += byAttacker.get(npcKey)?.total ?? 0;
    }

    // Healing in this encounter window, summed per healer once (a healer's heals all fall
    // inside their own activity, so windowing to [start, end] equals the per-person window).
    const healByHealer = new Map<string, number>();
    for (const h of f.healLog) {
      if (h.tsMs >= startMs && h.tsMs <= endMs) healByHealer.set(h.healer, (healByHealer.get(h.healer) ?? 0) + h.amount);
    }

    const allCards: EncounterCard[] = [...byOwner.entries()].map(([ownerKey, acc]): EncounterCard => {
      // Per-person active window: from their first engagement (their attack, or the NPC first
      // hitting/casting on them) to the encounter's end.
      let first = ownerFirst.get(ownerKey) ?? Infinity;
      const npcToOwner = f.pairFirst.get(`${npcKey}>${ownerKey}`);
      if (npcToOwner !== undefined) first = Math.min(first, npcToOwner);
      const activeStart = Number.isFinite(first) ? first : startMs;
      const activeDur = Math.max(1, (endMs - activeStart) / 1000);

      const takenAcc = f.perTarget.get(ownerKey)?.get(npcKey) ?? newMetric();
      // A summoned pet folded into its owner above and never reaches here, so a "pet"
      // card is always a charmed mob — its own row, per the owner's row alongside it.
      const charm = this.charmed.get(ownerKey);
      // A mob that was charmed at any point in this fight reads as a pet for the whole of it.
      // Flipping it back to a plain row for the stretches the flag happened to be off would
      // relabel the same combatant several times inside one encounter.
      const isPet = charm !== undefined || f.everCharmed.has(ownerKey);
      return {
        name: this.nameOf(ownerKey),
        kind: ownerKey === this.selfKey ? "self" : isPet ? "pet" : "player",
        isSelf: ownerKey === this.selfKey,
        ...(charm?.ownerKey ? { ownerName: this.nameOf(charm.ownerKey) } : {}),
        ...(charm?.ownerKey && charm.ownerGuess ? { ownerGuess: true } : {}),
        // This row is the charmed half of a same-named pair, so its figures are the whole
        // exchange between the two — an upper bound on the pet, not its output alone.
        ...(isTwinKey(ownerKey) ? { ambiguous: true } : {}),
        damage: this.toStat(acc, activeDur),
        healing: rateStat(healByHealer.get(ownerKey) ?? 0, activeDur),
        taken: this.toStat(takenAcc, activeDur),
        activeSec: Math.round(activeDur),
        pct: total > 0 ? Math.round((acc.total / total) * 1000) / 10 : 0,
      };
    });
    // Sort by share of damage dealt to the mob (i.e. total), DPS as a tiebreak.
    const byShare = (a: EncounterCard, b: EncounterCard) =>
      b.damage.total - a.damage.total || b.damage.perSec - a.damage.perSec;
    allCards.sort(byShare);
    const self = allCards.find((c) => c.isSelf);
    const others = allCards.filter((c) => !c.isSelf).slice(0, 5);
    const cards = (self ? [self, ...others] : others).sort(byShare);
    const { spark, bucketSec } = sparkline(f.selfHits.get(npcKey) ?? [], startMs, spanSec);
    // The mirror half of the strip, on the same buckets so the two line up bar for bar.
    const { spark: takenSpark } = sparkline(f.selfTaken.get(npcKey) ?? [], startMs, spanSec);
    // …and the mob's own pair, on those same buckets again: everything the group did to it,
    // and everything it did back to the group.
    const { spark: mobTakenSpark } = sparkline(f.hitsOn.get(npcKey) ?? [], startMs, spanSec);
    const { spark: mobDealtSpark } = sparkline(f.hitsBy.get(npcKey) ?? [], startMs, spanSec);
    // …and the combo I was in for each bucket, so the strip can be coloured by stance. A
    // bucket can straddle a stance change; the combo holding the most of it wins, which is
    // the same rule `dominantComboIn` applies to a whole encounter.
    const sparkCombos = this.comboPerBucket(startMs, endMs, bucketSec * 1000, spark.length);

    return {
      id,
      name: this.nameOf(npcKey),
      active,
      startMs,
      endMs,
      durationSec: Math.round(spanSec),
      total,
      dps: Math.round(total / spanSec),
      npcDamage: rateStat(npcOut, spanSec),
      selfSpark: spark,
      selfTakenSpark: takenSpark,
      mobTakenSpark,
      mobDealtSpark,
      sparkCombos,
      sparkBucketSec: bucketSec,
      cards,
    };
  }

  // --- classification + view building -------------------------------------

  private resolveKinds(f: FightState): { friendly: Set<string>; npc: Set<string> } {
    // A charmed mob seeds `friendly` as strongly as the self does. Every rule below
    // guards on `!friendly.has(...)` before adding to `npc`, so seeding it here is also
    // what stops the propagation walking it back to an enemy on its pre-charm swings.
    const friendly = new Set<string>([this.selfKey, ...this.charmed.keys()]);
    const npc = new Set<string>(f.npcSeeds);
    for (const key of this.charmed.keys()) npc.delete(key);
    // …and the reverse for anyone charmed away from us: hostile until it breaks.
    for (const key of this.charmedAway) {
      friendly.delete(key);
      npc.add(key);
    }

    // Two passes, in descending order of how much the evidence can be trusted. Every rule
    // guards on "not already classified", so whichever fires first wins — which used to be
    // an accident of log order. Running them in tiers lets the good evidence win: pass 0 is
    // attacking or being attacked by a *known* mob, heals, kills and pet ownership; pass 1
    // is the softer inference from who swung at whom.
    for (const phase of [0, 1]) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const [a, t] of f.damagePairs) {
          if (npc.has(t) && !npc.has(a) && !friendly.has(a)) (friendly.add(a), (changed = true));
          if (npc.has(a) && !npc.has(t) && !friendly.has(t)) (friendly.add(t), (changed = true));
          if (phase < 1 || a === t) continue;
          // A friendly's choice of target marks an enemy — but never a *charmed* one's.
          // A charmed mob is the one unreliable witness in the log: entities are keyed by
          // name and a generic name is not unique, so a charmed "a wan ghoul knight" shares
          // its key with the twin still fighting us ("A wan ghoul knight tries to slash a
          // wan ghoul knight, but misses!" is one real line), and whoever that twin mauls
          // would read as a mob — including the groupmate it is actually mauling.
          if (friendly.has(a) && !this.charmed.has(a) && !friendly.has(t) && !npc.has(t))
            (npc.add(t), (changed = true));
          // Nothing damages a friendly except an enemy — this game has no friendly fire.
          // Without this a mob nobody but a charmed pet ever touched stays unclassified and
          // gets no encounter, which is most of what another player's charm pet fights. A
          // charmed *target* is excluded for the same shared-key reason as above, mirrored:
          // "Hugh kicks a wan ghoul knight" would otherwise brand Hugh an enemy, because
          // the knight he is hitting is the twin of the one that is charmed.
          if (friendly.has(t) && !this.charmed.has(t) && !friendly.has(a) && !npc.has(a))
            (npc.add(a), (changed = true));
        }
        // Heals connect same-faction pairs.
        for (const [h, t] of f.healPairs) {
          if (friendly.has(h) && !friendly.has(t) && !npc.has(t)) (friendly.add(t), (changed = true));
          if (friendly.has(t) && !friendly.has(h) && !npc.has(h)) (friendly.add(h), (changed = true));
          if (npc.has(h) && !npc.has(t) && !friendly.has(t)) (npc.add(t), (changed = true));
          if (npc.has(t) && !npc.has(h) && !friendly.has(h)) (npc.add(h), (changed = true));
        }
        for (const d of f.deaths) {
          if (d.killer && friendly.has(d.killer) && !friendly.has(d.victim) && !npc.has(d.victim))
            (npc.add(d.victim), (changed = true));
          if (friendly.has(d.victim) && d.killer && !friendly.has(d.killer) && !npc.has(d.killer))
            (npc.add(d.killer), (changed = true));
          if (d.killer && npc.has(d.killer) && !friendly.has(d.victim) && !npc.has(d.victim))
            (friendly.add(d.victim), (changed = true));
        }
        // A pet shares its owner's faction.
        for (const [pet, owner] of this.petOwners) {
          if (friendly.has(owner) && !friendly.has(pet) && !npc.has(pet)) (friendly.add(pet), (changed = true));
          if (npc.has(owner) && !npc.has(pet) && !friendly.has(pet)) (npc.add(pet), (changed = true));
        }
      }
    }
    return { friendly, npc };
  }

  private durationSec(f: FightState): number {
    const end = f.endMs ?? f.lastActivityMs;
    return Math.max(1, (end - f.startMs) / 1000);
  }

  private toStat(m: MetricAcc, dur: number): MetricStat {
    return {
      total: m.total,
      perSec: Math.round(m.total / dur),
      hits: m.hits,
      crits: m.crits,
      avoided: m.avoided,
      byType: { ...m.byType }, // copy: buildFight may fold pet stats into an owner's copy
      entries: [...m.abilities.values()].sort((a, b) => b.total - a.total),
    };
  }

  private buildFight(f: FightState): Fight {
    const { friendly, npc } = this.resolveKinds(f);
    const dur = this.durationSec(f);

    // Build stats per combatant, keyed, tracking pet ownership.
    const byKey = new Map<string, { key: string; ownerKey: string | null; stats: CombatantStats }>();
    for (const c of f.combatants.values()) {
      const isSelf = c.key === this.selfKey;
      const charm = this.charmed.get(c.key);
      // Only a *summoned* pet folds into its owner below. A charmed mob keeps its own row
      // here exactly as it does in an encounter table, so its `ownerKey` stays null even
      // when a "Master" line arrived before the charm landed and left a `petOwners` entry.
      const ownerKey = charm ? null : this.petOwners.get(c.key) ?? null;
      const charmerKey = charm?.ownerKey ?? null;
      const kind = isSelf
        ? "self"
        : ownerKey || charm
          ? "pet"
          : npc.has(c.key)
            ? "npc"
            : friendly.has(c.key)
              ? "player"
              : "unknown";
      const stats: CombatantStats = {
        name: c.name,
        kind,
        isSelf,
        ...(ownerKey || charmerKey ? { ownerName: this.nameOf((ownerKey ?? charmerKey)!) } : {}),
        damage: this.toStat(c.done, dur),
        healing: this.toStat(c.heal, dur),
        taken: this.toStat(c.taken, dur),
      };
      if (isSelf && (c.stanceTotals.melee.size > 0 || c.stanceTotals.invocation.size > 0)) {
        stats.stances = {
          melee: this.stanceBreakdown(c.stanceTotals.melee, this.stanceSegments.melee, f, dur),
          invocation: this.stanceBreakdown(c.stanceTotals.invocation, this.stanceSegments.invocation, f, dur),
        };
      }
      byKey.set(c.key, { key: c.key, ownerKey, stats });
    }

    // Fold each identified pet into its owner (when the owner is in this fight),
    // tagging the pet's categories with 🐾 in the owner's drill-down.
    for (const entry of [...byKey.values()]) {
      const owner = entry.ownerKey ? byKey.get(entry.ownerKey) : undefined;
      if (owner) {
        mergeStat(owner.stats.damage, entry.stats.damage, dur);
        mergeStat(owner.stats.healing, entry.stats.healing, dur);
        mergeStat(owner.stats.taken, entry.stats.taken, dur);
        byKey.delete(entry.key);
      }
    }

    const combatants: CombatantStats[] = [...byKey.values()]
      .map((e) => e.stats)
      .filter((c) => c.damage.total > 0 || c.healing.total > 0 || c.taken.total > 0)
      .sort((a, b) => b.damage.total - a.damage.total);

    const stanceTimeline = this.clipStances(this.stanceSegments.melee, f);

    const headline = [...f.targetIncoming.entries()]
      .filter(([k]) => npc.has(k))
      .sort((a, b) => b[1].total - a[1].total)[0];
    const npcNames = [...npc].map((k) => this.nameOf(k));

    return {
      id: f.id,
      title: headline ? headline[1].name : npcNames[0] ?? "Combat",
      startMs: f.startMs,
      endMs: f.endMs,
      active: f.endMs === null,
      npcs: npcNames,
      combatants,
      stanceTimeline,
    };
  }

  private clipStances(segments: StanceSegment[], f: FightState): StanceSegment[] {
    const end = f.endMs ?? f.lastActivityMs;
    const out: StanceSegment[] = [];
    for (const seg of segments) {
      const segEnd = seg.endMs ?? end;
      if (segEnd < f.startMs || seg.startMs > end) continue;
      out.push({ startMs: Math.max(seg.startMs, f.startMs), endMs: Math.min(segEnd, end), stance: seg.stance });
    }
    return out;
  }

  /** Damage-by-stance for one dimension, with active-seconds from the clipped timeline. */
  private stanceBreakdown(
    totals: Map<string, number>,
    segments: StanceSegment[],
    f: FightState,
    dur: number,
  ): StanceBreakdown[] {
    const end = f.endMs ?? f.lastActivityMs;
    const secByStance = new Map<string, number>();
    for (const seg of this.clipStances(segments, f)) {
      const segEnd = seg.endMs ?? end;
      secByStance.set(seg.stance, (secByStance.get(seg.stance) ?? 0) + Math.max(0, (segEnd - seg.startMs) / 1000));
    }
    return [...totals.entries()]
      .map(([stance, total]) => ({
        stance,
        total,
        dps: Math.round(total / dur),
        activeSeconds: Math.round(secByStance.get(stance) ?? 0),
      }))
      .sort((a, b) => b.total - a.total);
  }

  private summarize(fight: Fight): FightSummary {
    const durationSec = Math.max(1, ((fight.endMs ?? fight.startMs) - fight.startMs) / 1000);
    const topDps = fight.combatants.find((c) => c.kind !== "npc")?.damage.perSec ?? 0;
    return {
      id: fight.id,
      title: fight.title,
      startMs: fight.startMs,
      endMs: fight.endMs,
      active: fight.active,
      durationSec: Math.round(durationSec),
      topDps,
    };
  }
}

// Re-export for consumers that build ability tables from a MetricStat.
export type { AbilityBreakdown };
