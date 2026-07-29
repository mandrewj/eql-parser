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
  Encounter,
  EncounterEntry,
  Fight,
  FightSummary,
  MetricStat,
  StanceBreakdown,
  StanceDim,
  StanceSegment,
  StanceState,
} from "../types.js";

const STANCE_DIMS: StanceDim[] = ["melee", "invocation"];

export interface EngineOptions {
  selfName: string; // resolved from the log filename; "You" maps to this
  inactivityTimeoutSec: number;
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
  deaths: Array<{ victim: string; killer: string | null; killerSelf: boolean }>;
  npcSeeds: Set<string>;
  targetIncoming: Map<string, { name: string; total: number }>;
  perTarget: Map<string, Map<string, number>>; // targetKey → attackerKey → damage
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
  private readonly petOwners = new Map<string, string>(); // petKey → ownerKey (global)

  private current: FightState | null = null;
  private finished: FightState[] = [];
  private fightSeq = 0;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.selfKey = opts.selfName.toLowerCase();
    this.display.set(this.selfKey, opts.selfName);
  }

  // --- public API ---------------------------------------------------------

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

  snapshot(): { current: Fight | null; recent: FightSummary[]; stance: StanceState } {
    const recent = this.finished.slice(-20).map((s) => this.summarize(this.buildFight(s)));
    return {
      current: this.current ? this.buildFight(this.current) : null,
      recent,
      stance: { ...this.currentStances },
    };
  }

  // --- stances ------------------------------------------------------------

  private applyStance(tsMs: number, dim: StanceDim, stance: string): void {
    const segs = this.stanceSegments[dim];
    const last = segs[segs.length - 1];
    if (last && last.endMs === null) last.endMs = tsMs;
    segs.push({ startMs: tsMs, endMs: null, stance });
    this.currentStances[dim] = stance;
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
      deaths: [],
      npcSeeds: new Set(),
      targetIncoming: new Map(),
      perTarget: new Map(),
      aliveEngaged: new Set(),
    };
    return this.current;
  }

  private closeFight(endMs: number): void {
    if (!this.current) return;
    this.current.endMs = endMs;
    this.finished.push(this.current);
    this.current = null;
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

    // Per-target attacker breakdown (for per-NPC encounter meters).
    let byAttacker = f.perTarget.get(tKey);
    if (!byAttacker) {
      byAttacker = new Map();
      f.perTarget.set(tKey, byAttacker);
    }
    byAttacker.set(aKey, (byAttacker.get(aKey) ?? 0) + ev.amount);

    const abilityName = ev.type === "melee" ? ev.verb : ev.type === "spell" ? ev.effect : ev.spell;
    const crit = ev.type === "melee" ? ev.crit : false;

    addAbility(this.combatant(f, aKey).done, abilityName, ev.type, ev.amount, crit);
    addAbility(this.combatant(f, tKey).taken, abilityName, ev.type, ev.amount, false);

    if (aKey === this.selfKey) {
      const c = this.combatant(f, aKey);
      for (const dim of STANCE_DIMS) {
        const s = this.currentStances[dim];
        c.stanceTotals[dim].set(s, (c.stanceTotals[dim].get(s) ?? 0) + ev.amount);
      }
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
    if (f.aliveEngaged.delete(vKey) && f.aliveEngaged.size === 0 && f.npcSeeds.size > 0) {
      this.closeFight(tsMs);
    }
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
    const encounters = this.buildEncounters(f, friendly, npc, dur);

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
      encounters,
      stanceTimeline,
    };
  }

  /** One per-NPC DPS meter: who dealt how much damage to each mob (pets folded into owners). */
  private buildEncounters(f: FightState, friendly: Set<string>, npc: Set<string>, dur: number): Encounter[] {
    const slain = new Set(f.deaths.filter((d) => npc.has(d.victim)).map((d) => d.victim));
    const encounters: Encounter[] = [];

    for (const [tKey, attackers] of f.perTarget) {
      if (!npc.has(tKey)) continue;
      const byOwner = new Map<string, number>();
      for (const [aKey, amt] of attackers) {
        const ownerKey = this.petOwners.get(aKey) ?? aKey; // fold pet damage into owner
        if (ownerKey !== this.selfKey && !friendly.has(ownerKey)) continue; // friendly attackers only
        byOwner.set(ownerKey, (byOwner.get(ownerKey) ?? 0) + amt);
      }
      const total = [...byOwner.values()].reduce((s, v) => s + v, 0);
      if (total === 0) continue;

      const entries: EncounterEntry[] = [...byOwner.entries()]
        .map(([k, tot]): EncounterEntry => ({
          name: this.nameOf(k),
          kind: k === this.selfKey ? "self" : "player",
          isSelf: k === this.selfKey,
          total: tot,
          dps: Math.round(tot / dur),
          pct: Math.round((tot / total) * 1000) / 10,
        }))
        .sort((a, b) => b.total - a.total);

      encounters.push({
        name: this.nameOf(tKey),
        active: f.endMs === null && !slain.has(tKey),
        total,
        dps: Math.round(total / dur),
        attackers: entries,
      });
    }

    return encounters.sort((a, b) => Number(b.active) - Number(a.active) || b.total - a.total);
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
