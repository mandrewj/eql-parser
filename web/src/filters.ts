import type { AbilityBreakdown, CombatantStats, DamageType, Fight, Filters, StanceBreakdown } from "./types";
import { ALL_TYPES } from "./types";

export interface DisplayRow {
  key: string;
  name: string;
  kind: CombatantStats["kind"];
  isSelf: boolean;
  total: number;
  dps: number;
  pct: number;
  hits: number;
  crits: number;
  misses: number;
  abilities: AbilityBreakdown[];
  stances?: StanceBreakdown[];
  stanceFiltered: boolean;
}

export function durationSec(fight: Fight): number {
  return Math.max(1, ((fight.endMs ?? Date.now()) - fight.startMs) / 1000);
}

/** Apply kind/type/stance filters to a fight's combatants, returning sorted rows. */
export function computeRows(fight: Fight, filters: Filters): DisplayRow[] {
  const dur = durationSec(fight);
  const selectedTypes = ALL_TYPES.filter((t) => filters.types[t]);

  const visible = fight.combatants.filter((c) =>
    c.kind === "npc" ? filters.showNpcs : filters.showPlayers,
  );

  const rows: DisplayRow[] = visible.map((c) => {
    const useStanceLens = Boolean(filters.stance) && c.isSelf && Array.isArray(c.stances);
    if (useStanceLens) {
      const s = c.stances!.find((x) => x.stance === filters.stance);
      return {
        key: c.name,
        name: c.name,
        kind: c.kind,
        isSelf: c.isSelf,
        total: s?.total ?? 0,
        dps: s?.dps ?? 0,
        pct: 0,
        hits: c.hits,
        crits: c.crits,
        misses: c.misses,
        abilities: [],
        stances: c.stances,
        stanceFiltered: true,
      };
    }
    const total = selectedTypes.reduce((sum, t) => sum + (c.byType[t] ?? 0), 0);
    const abilities = c.abilities.filter(
      (a) => a.damageType !== "unknown" && filters.types[a.damageType as Exclude<DamageType, "unknown">],
    );
    return {
      key: c.name,
      name: c.name,
      kind: c.kind,
      isSelf: c.isSelf,
      total,
      dps: Math.round(total / dur),
      pct: 0,
      hits: c.hits,
      crits: c.crits,
      misses: c.misses,
      abilities,
      stances: c.stances,
      stanceFiltered: false,
    };
  });

  const friendlyTotal = rows.filter((r) => r.kind !== "npc").reduce((s, r) => s + r.total, 0);
  const npcTotal = rows.filter((r) => r.kind === "npc").reduce((s, r) => s + r.total, 0);
  for (const r of rows) {
    const denom = r.kind === "npc" ? npcTotal : friendlyTotal;
    r.pct = denom > 0 ? Math.round((r.total / denom) * 1000) / 10 : 0;
  }

  return rows.sort((a, b) => b.total - a.total);
}

/** Stance names available in a fight (from the self combatant), for the filter dropdown. */
export function stancesOf(fight: Fight | null): string[] {
  const self = fight?.combatants.find((c) => c.isSelf);
  return self?.stances?.map((s) => s.stance) ?? [];
}
