import type { AbilityBreakdown, CombatantStats, DamageType, Fight, Filters, StanceBreakdown } from "./types";
import { ALL_TYPES } from "./types";

export interface DisplayRow {
  key: string;
  name: string;
  kind: CombatantStats["kind"];
  ownerName?: string;
  isSelf: boolean;
  total: number;
  perSec: number;
  pct: number;
  hits: number;
  crits: number;
  avoided: number;
  byType?: Record<DamageType, number>; // damage/taken only
  entries: AbilityBreakdown[];
  stances?: StanceBreakdown[]; // self, damage metric
  stanceFiltered: boolean;
}

export function durationSec(fight: Fight): number {
  return Math.max(1, ((fight.endMs ?? Date.now()) - fight.startMs) / 1000);
}

/** Unit + label for the active metric. */
export function metricMeta(metric: Filters["metric"]): { unit: string; label: string; typed: boolean; stance: boolean } {
  switch (metric) {
    case "healing":
      return { unit: "hps", label: "Healing done", typed: false, stance: false };
    case "taken":
      return { unit: "dps", label: "Damage taken", typed: true, stance: false };
    default:
      return { unit: "dps", label: "Damage done", typed: true, stance: true };
  }
}

/** Apply metric + kind/type/stance filters to a fight, returning sorted rows. */
export function computeRows(fight: Fight, filters: Filters): DisplayRow[] {
  const dur = durationSec(fight);
  const { typed, stance: allowStance } = metricMeta(filters.metric);
  const selectedTypes = ALL_TYPES.filter((t) => filters.types[t]);

  const visible = fight.combatants.filter((c) =>
    c.kind === "npc" ? filters.showNpcs : filters.showPlayers,
  );

  const rows: DisplayRow[] = visible.map((c) => {
    const m = c[filters.metric];
    const base = { key: c.name, name: c.name, kind: c.kind, ownerName: c.ownerName, isSelf: c.isSelf, hits: m.hits, crits: m.crits, avoided: m.avoided };

    // Stance lens: damage metric, self only.
    if (allowStance && filters.stance && c.isSelf && c.stances) {
      const s = c.stances.find((x) => x.stance === filters.stance);
      return { ...base, total: s?.total ?? 0, perSec: s?.dps ?? 0, pct: 0, entries: [], stances: c.stances, stanceFiltered: true };
    }

    if (typed) {
      const total = selectedTypes.reduce((sum, t) => sum + (m.byType[t] ?? 0), 0);
      const entries = m.entries.filter(
        (e) => e.damageType !== "unknown" && filters.types[e.damageType as Exclude<DamageType, "unknown">],
      );
      return { ...base, total, perSec: Math.round(total / dur), pct: 0, byType: m.byType, entries, stances: c.stances, stanceFiltered: false };
    }

    // Healing (no types).
    return { ...base, total: m.total, perSec: Math.round(m.total / dur), pct: 0, entries: m.entries, stanceFiltered: false };
  });

  const friendlyTotal = rows.filter((r) => r.kind !== "npc").reduce((s, r) => s + r.total, 0);
  const npcTotal = rows.filter((r) => r.kind === "npc").reduce((s, r) => s + r.total, 0);
  for (const r of rows) {
    const denom = r.kind === "npc" ? npcTotal : friendlyTotal;
    r.pct = denom > 0 ? Math.round((r.total / denom) * 1000) / 10 : 0;
  }

  return rows.filter((r) => r.total > 0 || r.avoided > 0).sort((a, b) => b.total - a.total);
}

export function stancesOf(fight: Fight | null): string[] {
  const self = fight?.combatants.find((c) => c.isSelf);
  return self?.stances?.map((s) => s.stance) ?? [];
}
