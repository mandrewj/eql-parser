import type { CombatantStats, Fight, Filters, MetricKind } from "./types";

export function durationSec(fight: Fight): number {
  return Math.max(1, ((fight.endMs ?? Date.now()) - fight.startMs) / 1000);
}

export function metricMeta(metric: MetricKind): { unit: string; label: string; icon: string; accent: string } {
  switch (metric) {
    case "healing":
      return { unit: "hps", label: "Healing", icon: "✚", accent: "heal" };
    case "taken":
      return { unit: "dps", label: "Taken", icon: "🛡", accent: "tank" };
    default:
      return { unit: "dps", label: "Damage", icon: "⚔", accent: "dmg" };
  }
}

/** Character rows visible for the current "who" filters, ranked by the chosen metric. */
export function rankedCombatants(
  fight: Fight | null,
  filters: Filters,
): { rows: CombatantStats[]; maxima: Record<MetricKind, number> } {
  if (!fight) return { rows: [], maxima: { damage: 1, healing: 1, taken: 1 } };
  const rows = fight.combatants
    .filter((c) => (c.kind === "npc" ? filters.showNpcs : filters.showPlayers))
    .filter((c) => c.damage.total > 0 || c.healing.total > 0 || c.taken.total > 0)
    .sort((a, b) => b[filters.metric].total - a[filters.metric].total);

  const maxima: Record<MetricKind, number> = {
    damage: Math.max(1, ...rows.map((r) => r.damage.total)),
    healing: Math.max(1, ...rows.map((r) => r.healing.total)),
    taken: Math.max(1, ...rows.map((r) => r.taken.total)),
  };
  return { rows, maxima };
}

export function stancesOf(fight: Fight | null): string[] {
  const self = fight?.combatants.find((c) => c.isSelf);
  return self?.stances?.map((s) => s.stance) ?? [];
}
