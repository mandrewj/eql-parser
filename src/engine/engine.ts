// Combat engine: consumes CombatEvents in chronological order and produces
// fights with per-combatant DPS, damage-type + per-ability drill-down, and a
// self stance breakdown.
//
// Friend/foe classification from a single client's log is inherently fuzzy, so
// we don't trust names' capitalization (EQ capitalizes the first word of a line,
// making "Orc legionnaire" and "orc legionnaire" the same mob). Entities are
// keyed case-insensitively and classified by iterative propagation from strong
// seeds: the self only attacks/is attacked by NPCs, and "You have slain X" ⇒ X is an NPC.

import type {
  AbilityBreakdown,
  CombatEvent,
  CombatantStats,
  DamageType,
  Fight,
  FightSummary,
  StanceSegment,
} from "../types.js";

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

interface CombatantAgg {
  key: string;
  name: string;
  total: number;
  hits: number;
  crits: number;
  misses: number;
  byType: Record<DamageType, number>;
  abilities: Map<string, AbilityAgg>;
  stanceTotals: Map<string, number>; // self only
}

interface FightState {
  id: string;
  startMs: number;
  endMs: number | null;
  lastActivityMs: number;
  combatants: Map<string, CombatantAgg>;
  damagePairs: Array<[string, string]>; // [attackerKey, targetKey], incl. misses
  deaths: Array<{ victim: string; killer: string | null; killerSelf: boolean }>;
  npcSeeds: Set<string>; // strong NPC seeds (self targets/attackers, you-slain)
  targetIncoming: Map<string, { name: string; total: number }>;
  aliveEngaged: Set<string>; // seeded NPCs not yet slain
}

const emptyByType = (): Record<DamageType, number> => ({ melee: 0, spell: 0, dot: 0, unknown: 0 });

export class Engine {
  private readonly opts: EngineOptions;
  private readonly selfKey: string;
  private readonly display = new Map<string, string>();

  private currentStance = "unknown";
  private stanceSegments: StanceSegment[] = [];

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
      this.applyStance(ev.tsMs, ev.stance);
      return;
    }
    this.maybeCloseForInactivity(ev.tsMs);
    switch (ev.type) {
      case "melee":
      case "spell":
      case "dot":
        this.recordDamage(ev);
        break;
      case "miss":
        this.recordInteraction(ev.attacker, ev.target, ev.tsMs, { miss: true });
        break;
      case "death":
        this.recordDeath(ev.victim, ev.killer, ev.tsMs);
        break;
    }
  }

  /** Flush any open fight — call once after replaying a whole file. */
  endInput(): void {
    if (this.current) this.closeFight(this.current.lastActivityMs);
  }

  get stance(): string {
    return this.currentStance;
  }

  /** All fights (finished + the current one), newest last. */
  fights(): Fight[] {
    const states = this.current ? [...this.finished, this.current] : [...this.finished];
    return states.map((s) => this.buildFight(s));
  }

  snapshot(): { current: Fight | null; recent: FightSummary[]; stance: string } {
    const recent = this.finished.slice(-20).map((s) => this.summarize(this.buildFight(s)));
    return {
      current: this.current ? this.buildFight(this.current) : null,
      recent,
      stance: this.currentStance,
    };
  }

  // --- stances ------------------------------------------------------------

  private applyStance(tsMs: number, stance: string): void {
    const last = this.stanceSegments[this.stanceSegments.length - 1];
    if (last && last.endMs === null) last.endMs = tsMs;
    this.stanceSegments.push({ startMs: tsMs, endMs: null, stance });
    this.currentStance = stance;
  }

  // --- identity -----------------------------------------------------------

  private keyOf(name: string): string {
    if (/^you$/i.test(name) || name.toLowerCase() === this.selfKey) return this.selfKey;
    return name.toLowerCase();
  }

  private see(key: string, name: string): void {
    if (key === this.selfKey) return; // display already the resolved self name
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
      deaths: [],
      npcSeeds: new Set(),
      targetIncoming: new Map(),
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
    const gapMs = tsMs - this.current.lastActivityMs;
    if (gapMs > this.opts.inactivityTimeoutSec * 1000) {
      this.closeFight(this.current.lastActivityMs);
    }
  }

  // --- recording ----------------------------------------------------------

  private combatant(f: FightState, key: string, name: string): CombatantAgg {
    let c = f.combatants.get(key);
    if (!c) {
      c = {
        key,
        name,
        total: 0,
        hits: 0,
        crits: 0,
        misses: 0,
        byType: emptyByType(),
        abilities: new Map(),
        stanceTotals: new Map(),
      };
      f.combatants.set(key, c);
    }
    return c;
  }

  /** Shared classification bookkeeping for both hits and misses. */
  private recordInteraction(
    attacker: string,
    target: string,
    tsMs: number,
    opt: { miss?: boolean } = {},
  ): { f: FightState; aKey: string; tKey: string } {
    const f = this.openFight(tsMs);
    f.lastActivityMs = tsMs;
    const aKey = this.keyOf(attacker);
    const tKey = this.keyOf(target);
    this.see(aKey, attacker);
    this.see(tKey, target);
    f.damagePairs.push([aKey, tKey]);

    // Strong NPC seeds: the self only fights NPCs.
    if (aKey === this.selfKey && tKey !== this.selfKey) {
      f.npcSeeds.add(tKey);
      f.aliveEngaged.add(tKey);
    }
    if (tKey === this.selfKey && aKey !== this.selfKey) {
      f.npcSeeds.add(aKey);
      f.aliveEngaged.add(aKey);
    }

    if (opt.miss) {
      this.combatant(f, aKey, this.nameOf(aKey)).misses++;
    }
    return { f, aKey, tKey };
  }

  private recordDamage(
    ev: Extract<CombatEvent, { type: "melee" | "spell" | "dot" }>,
  ): void {
    const attacker = ev.type === "melee" ? ev.attacker : ev.type === "spell" ? ev.owner : ev.caster;
    const { f, aKey, tKey } = this.recordInteraction(attacker, ev.target, ev.tsMs);

    // target incoming (for headline / NPC view)
    const inc = f.targetIncoming.get(tKey) ?? { name: this.nameOf(tKey), total: 0 };
    inc.total += ev.amount;
    f.targetIncoming.set(tKey, inc);

    const c = this.combatant(f, aKey, this.nameOf(aKey));
    c.total += ev.amount;
    c.hits++;
    c.byType[ev.type] += ev.amount;
    const crit = ev.type === "melee" ? ev.crit : false;
    if (crit) c.crits++;

    const abilityName =
      ev.type === "melee" ? ev.verb : ev.type === "spell" ? ev.effect : ev.spell;
    const akey = `${ev.type}:${abilityName.toLowerCase()}`;
    let a = c.abilities.get(akey);
    if (!a) {
      a = { name: abilityName, damageType: ev.type, total: 0, hits: 0, crits: 0 };
      c.abilities.set(akey, a);
    }
    a.total += ev.amount;
    a.hits++;
    if (crit) a.crits++;

    if (aKey === this.selfKey) {
      c.stanceTotals.set(this.currentStance, (c.stanceTotals.get(this.currentStance) ?? 0) + ev.amount);
    }
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

    // If a seeded NPC dies, drop it; when none remain, the pull is over.
    if (f.aliveEngaged.delete(vKey) && f.aliveEngaged.size === 0 && f.npcSeeds.size > 0) {
      this.closeFight(tsMs);
    }
  }

  // --- classification + view building -------------------------------------

  /** Resolve friend/foe for a fight via iterative propagation from seeds. */
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
      for (const d of f.deaths) {
        if (d.killer && friendly.has(d.killer) && !friendly.has(d.victim) && !npc.has(d.victim))
          (npc.add(d.victim), (changed = true));
        if (friendly.has(d.victim) && d.killer && !friendly.has(d.killer) && !npc.has(d.killer))
          (npc.add(d.killer), (changed = true));
        if (d.killer && npc.has(d.killer) && !friendly.has(d.victim) && !npc.has(d.victim))
          (friendly.add(d.victim), (changed = true));
      }
    }
    return { friendly, npc };
  }

  private durationSec(f: FightState): number {
    const end = f.endMs ?? f.lastActivityMs;
    return Math.max(1, (end - f.startMs) / 1000);
  }

  private buildFight(f: FightState): Fight {
    const { friendly, npc } = this.resolveKinds(f);
    const durationSec = this.durationSec(f);

    const friendlyTotal = [...f.combatants.values()]
      .filter((c) => friendly.has(c.key))
      .reduce((s, c) => s + c.total, 0);
    const npcTotal = [...f.combatants.values()]
      .filter((c) => npc.has(c.key))
      .reduce((s, c) => s + c.total, 0);

    const combatants: CombatantStats[] = [...f.combatants.values()]
      .map((c) => {
        const isSelf = c.key === this.selfKey;
        const kind = isSelf ? "self" : npc.has(c.key) ? "npc" : friendly.has(c.key) ? "player" : "unknown";
        const denom = kind === "npc" ? npcTotal : friendlyTotal;
        const abilities: AbilityBreakdown[] = [...c.abilities.values()].sort(
          (a, b) => b.total - a.total,
        );
        const stats: CombatantStats = {
          name: c.name,
          kind,
          isSelf,
          total: c.total,
          dps: Math.round(c.total / durationSec),
          pct: denom > 0 ? Math.round((c.total / denom) * 1000) / 10 : 0,
          hits: c.hits,
          crits: c.crits,
          misses: c.misses,
          byType: c.byType,
          abilities,
        };
        if (isSelf && c.stanceTotals.size > 0) {
          stats.stances = [...c.stanceTotals.entries()]
            .map(([stance, total]) => ({
              stance,
              total,
              dps: Math.round(total / durationSec),
              activeSeconds: 0, // filled from the clipped timeline below
            }))
            .sort((a, b) => b.total - a.total);
        }
        return stats;
      })
      .sort((a, b) => b.total - a.total);

    // Clip the global stance timeline to this fight and fill activeSeconds.
    const stanceTimeline = this.clipStances(f);
    const self = combatants.find((c) => c.isSelf);
    if (self?.stances) {
      const secByStance = new Map<string, number>();
      for (const seg of stanceTimeline) {
        const end = seg.endMs ?? (f.endMs ?? f.lastActivityMs);
        secByStance.set(seg.stance, (secByStance.get(seg.stance) ?? 0) + Math.max(0, (end - seg.startMs) / 1000));
      }
      for (const s of self.stances) s.activeSeconds = Math.round(secByStance.get(s.stance) ?? 0);
    }

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

  private clipStances(f: FightState): StanceSegment[] {
    const end = f.endMs ?? f.lastActivityMs;
    const out: StanceSegment[] = [];
    for (const seg of this.stanceSegments) {
      const segEnd = seg.endMs ?? end;
      if (segEnd < f.startMs || seg.startMs > end) continue;
      out.push({
        startMs: Math.max(seg.startMs, f.startMs),
        endMs: Math.min(segEnd, end),
        stance: seg.stance,
      });
    }
    return out;
  }

  private summarize(fight: Fight): FightSummary {
    const durationSec = Math.max(
      1,
      ((fight.endMs ?? fight.startMs) - fight.startMs) / 1000,
    );
    const topDps = fight.combatants.find((c) => c.kind !== "npc")?.dps ?? 0;
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
