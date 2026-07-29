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

import type {
  AbilityBreakdown,
  CombatEvent,
  CombatantStats,
  DamageType,
  EncounterCard,
  EncounterView,
  Fight,
  FightSummary,
  MetricStat,
  StanceBreakdown,
  StanceDim,
  StanceOverviewRow,
  StanceSegment,
  StanceState,
} from "../types.js";

const STANCE_DIMS: StanceDim[] = ["melee", "invocation"];

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
  pairFirst: Map<string, number>; // "attackerKey>targetKey" → first contact ms (per-person start)
  firstSeen: Map<string, number>; // entityKey → first event ms (encounter start)
  lastSeen: Map<string, number>; // entityKey → last event ms (for per-NPC staleness)
  aliveEngaged: Set<string>;
}

const emptyByType = (): Record<DamageType, number> => ({ melee: 0, spell: 0, dot: 0, unknown: 0 });
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
  private readonly petOwners = new Map<string, string>(); // petKey → ownerKey (global)

  private current: FightState | null = null;
  private finished: FightState[] = [];
  private finishedEncounters: EncounterView[] = []; // newest first, rolling
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
      this.petOwners.set(pk, this.keyOf(ev.owner));
      return;
    }
    if (ev.type === "zone") {
      // Zoning leaves all mobs behind — end the current fight immediately.
      if (this.current) this.closeFight(this.current.lastActivityMs);
      return;
    }
    this.maybeCloseForInactivity(ev.tsMs);
    if (ev.type === "heal") {
      this.recordHeal(ev.healer, ev.target, ev.amount, ev.spell, ev.tsMs);
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
    stanceOverview: Array<{ n: number; rows: StanceOverviewRow[] }>;
  } {
    const recent = this.finished.slice(-20).map((s) => this.summarize(this.buildFight(s)));
    return {
      current: this.current ? this.buildFight(this.current) : null,
      recent,
      activeEncounters: this.current ? this.buildLiveEncounters(this.current) : [],
      recentEncounters: this.finishedEncounters.slice(0, 5),
      stance: { ...this.currentStances },
      stanceOverview: this.buildStanceOverviews(),
    };
  }

  /** Seconds spent in each stance combo within [startMs, endMs] (incl. the open segment). */
  private comboSecondsIn(startMs: number, endMs: number): Map<string, number> {
    const segs = [...this.comboSegments, { startMs: this.comboStartMs, endMs, combo: this.combo() }];
    const out = new Map<string, number>();
    for (const seg of segs) {
      const s = Math.max(seg.startMs, startMs);
      const e = Math.min(seg.endMs, endMs);
      if (e <= s) continue;
      out.set(seg.combo, (out.get(seg.combo) ?? 0) + (e - s) / 1000);
    }
    return out;
  }

  private buildStanceOverviews(): Array<{ n: number; rows: StanceOverviewRow[] }> {
    return [10, 25, 50].map((n) => ({ n, rows: this.overviewForWindow(n) }));
  }

  /** Average self DPS per stance+invocation combo over the last N finished encounters. */
  private overviewForWindow(n: number): StanceOverviewRow[] {
    const encs = this.finishedEncounters.slice(0, n);
    if (encs.length === 0) return [];

    // Merge the encounters' time windows so simultaneous mobs aren't double-counted.
    const merged: Array<[number, number]> = [];
    for (const iv of encs.map((e): [number, number] => [e.startMs, e.endMs]).sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    const inMerged = (ts: number) => merged.some(([s, e]) => ts >= s && ts <= e);

    const agg = new Map<string, { damage: number; seconds: number }>();
    for (const [s, e] of merged) {
      for (const [combo, sec] of this.comboSecondsIn(s, e)) {
        const a = agg.get(combo) ?? { damage: 0, seconds: 0 };
        a.seconds += sec;
        agg.set(combo, a);
      }
    }
    for (const ent of this.selfComboLog) {
      if (!inMerged(ent.ts)) continue;
      const a = agg.get(ent.combo) ?? { damage: 0, seconds: 0 };
      a.damage += ent.amount;
      agg.set(ent.combo, a);
    }

    return [...agg.entries()]
      .map(([combo, v]) => {
        const [melee = "none", invocation = "none"] = combo.split("|");
        return { melee, invocation, damage: v.damage, seconds: Math.round(v.seconds), dps: Math.round(v.damage / Math.max(1, v.seconds)) };
      })
      .filter((r) => r.damage > 0)
      .sort((a, b) => b.dps - a.dps);
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
      pairFirst: new Map(),
      firstSeen: new Map(),
      lastSeen: new Map(),
      aliveEngaged: new Set(),
    };
    return this.current;
  }

  private closeFight(endMs: number): void {
    if (!this.current) return;
    // Any engaged-but-unslain NPCs (a boss you fled, a zoned pull) still complete.
    this.finalizeOpenEncounters(this.current, endMs);
    this.current.endMs = endMs;
    this.finished.push(this.current);
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
  ): { f: FightState; aKey: string; tKey: string } {
    const f = this.openFight(tsMs);
    f.lastActivityMs = tsMs;
    const aKey = this.keyOf(attacker);
    const tKey = this.keyOf(target);
    this.see(aKey, attacker);
    this.see(tKey, target);
    f.damagePairs.push([aKey, tKey]);
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
    const { f, aKey, tKey } = this.recordInteraction(attacker, ev.target, ev.tsMs);

    const inc = f.targetIncoming.get(tKey) ?? { name: this.nameOf(tKey), total: 0 };
    inc.total += ev.amount;
    f.targetIncoming.set(tKey, inc);

    const abilityName = ev.type === "melee" ? ev.verb : ev.type === "spell" ? ev.effect : ev.spell;
    const crit = ev.type === "melee" ? ev.crit : false;

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

    if (aKey === this.selfKey) {
      const c = this.combatant(f, aKey);
      for (const dim of STANCE_DIMS) {
        const s = this.currentStances[dim];
        c.stanceTotals[dim].set(s, (c.stanceTotals[dim].get(s) ?? 0) + ev.amount);
      }
      this.selfComboLog.push({ combo: this.combo(), amount: ev.amount, ts: ev.tsMs });
    }
  }

  private recordMiss(attacker: string, target: string, tsMs: number): void {
    const { f, aKey, tKey } = this.recordInteraction(attacker, target, tsMs);
    this.combatant(f, aKey).done.avoided++;
    this.combatant(f, tKey).taken.avoided++;
  }

  private recordHeal(healer: string, target: string, amount: number, spell: string | undefined, tsMs: number): void {
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
    addAbility(this.combatant(f, hKey).heal, spell ?? "Heal", "unknown", amount, false);
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
    // A slain NPC completes its encounter → add it to the rolling recent list.
    this.finalizeEncounter(f, vKey, tsMs);
    if (f.aliveEngaged.delete(vKey) && f.aliveEngaged.size === 0 && f.npcSeeds.size > 0) {
      this.closeFight(tsMs);
    }
  }

  /** On death: record the completed encounter, then reset the mob's tracking so a
   *  same-named respawn is a fresh instance (fixes generic-name merging). */
  private finalizeEncounter(f: FightState, npcKey: string, deathMs: number): void {
    const { friendly, npc } = this.resolveKinds(f);
    if (npc.has(npcKey)) this.pushEncounter(f, npcKey, deathMs, friendly);
    this.resetNpcTracking(f, npcKey);
  }

  private pushEncounter(f: FightState, npcKey: string, endMs: number, friendly: Set<string>): void {
    const view = this.encounterView(f, npcKey, endMs, false, `enc-${this.encounterSeq + 1}`, friendly);
    if (!view) return;
    this.encounterSeq++;
    this.finishedEncounters.unshift(view);
    if (this.finishedEncounters.length > 60) this.finishedEncounters.length = 60;
    // Drop combo-log entries older than the oldest encounter we still keep.
    const oldest = this.finishedEncounters[this.finishedEncounters.length - 1]?.startMs ?? 0;
    let drop = 0;
    while (drop < this.selfComboLog.length && this.selfComboLog[drop]!.ts < oldest) drop++;
    if (drop > 0) this.selfComboLog.splice(0, drop);
  }

  /** Clear a mob's per-encounter tracking so the next same-named mob starts fresh. */
  private resetNpcTracking(f: FightState, npcKey: string): void {
    f.perTarget.delete(npcKey);
    for (const m of f.perTarget.values()) m.delete(npcKey);
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
    const idleMs = this.opts.inactivityTimeoutSec * 1000;
    const out: EncounterView[] = [];
    for (const tKey of f.perTarget.keys()) {
      if (!npc.has(tKey) || slain.has(tKey)) continue;
      const ownerKey = tKey.endsWith(" pet") ? tKey.slice(0, -4) : null;
      if (ownerKey && slain.has(ownerKey)) continue; // pet despawns with its owner
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
      const ownerKey = this.petOwners.get(aKey) ?? aKey;
      if (ownerKey !== this.selfKey && !friendly.has(ownerKey)) continue;
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
    const total = [...byOwner.values()].reduce((s, a) => s + a.total, 0);

    const allCards: EncounterCard[] = [...byOwner.entries()].map(([ownerKey, acc]): EncounterCard => {
      // Per-person active window: from their first engagement (their attack, or the NPC first
      // hitting/casting on them) to the encounter's end.
      let first = ownerFirst.get(ownerKey) ?? Infinity;
      const npcToOwner = f.pairFirst.get(`${npcKey}>${ownerKey}`);
      if (npcToOwner !== undefined) first = Math.min(first, npcToOwner);
      const activeStart = Number.isFinite(first) ? first : startMs;
      const activeDur = Math.max(1, (endMs - activeStart) / 1000);

      const takenAcc = f.perTarget.get(ownerKey)?.get(npcKey) ?? newMetric();
      const healAcc = newMetric(); // healing windowed to this person's active time
      for (const h of f.healLog) {
        if (h.healer === ownerKey && h.tsMs >= activeStart && h.tsMs <= endMs) {
          addAbility(healAcc, h.spell, "unknown", h.amount, false);
        }
      }
      return {
        name: this.nameOf(ownerKey),
        kind: ownerKey === this.selfKey ? "self" : "player",
        isSelf: ownerKey === this.selfKey,
        damage: this.toStat(acc, activeDur),
        healing: this.toStat(healAcc, activeDur),
        taken: this.toStat(takenAcc, activeDur),
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

    return {
      id,
      name: this.nameOf(npcKey),
      active,
      startMs,
      endMs,
      durationSec: Math.round(Math.max(1, (endMs - startMs) / 1000)),
      total,
      cards,
    };
  }

  // --- classification + view building -------------------------------------

  private resolveKinds(f: FightState): { friendly: Set<string>; npc: Set<string> } {
    const friendly = new Set<string>([this.selfKey]);
    const npc = new Set<string>(f.npcSeeds);

    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, t] of f.damagePairs) {
        if (npc.has(t) && !npc.has(a) && !friendly.has(a)) (friendly.add(a), (changed = true));
        if (npc.has(a) && !npc.has(t) && !friendly.has(t)) (friendly.add(t), (changed = true));
        if (friendly.has(a) && a !== t && !friendly.has(t) && !npc.has(t)) (npc.add(t), (changed = true));
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
      const ownerKey = this.petOwners.get(c.key) ?? null;
      const kind = isSelf
        ? "self"
        : ownerKey
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
        ...(ownerKey ? { ownerName: this.nameOf(ownerKey) } : {}),
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
