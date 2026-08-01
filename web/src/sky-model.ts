// The Plane of Sky tracker's arithmetic, kept apart from the panel that draws it.
//
// Same split as `stats.ts` against `components.tsx`: these are the rules that decide what is
// finished and what is still worth farming, and they are worth testing without a renderer.

import type { SkyClass, SkyQuest } from "./types";

/** Where a quest stands. Derived rather than stored — there is no persistence in this app, and
 *  the whole state is a function of the inventory export and the log. */
export type QuestState = "done" | "ready" | "partial" | "open";

export interface QuestProgress {
  state: QuestState;
  /** Components held / needed. Excludes the rune, which is asked for rather than found. */
  have: number;
  need: number;
  runeHeld: boolean;
}

export function progressOf(quest: SkyQuest, held: Map<string, number>): QuestProgress {
  const have = quest.items.filter((i) => held.has(i.name)).length;
  const need = quest.items.length;
  // Every reward, not any: Beastlord's Test of Claw hands over a weapon for each hand, and
  // holding one of the two is not a finished quest.
  const done = quest.rewards.length > 0 && quest.rewards.every((r) => held.has(r));
  const state: QuestState = done ? "done" : have === need && need > 0 ? "ready" : have > 0 ? "partial" : "open";
  return { state, have, need, runeHeld: held.has(quest.rune) };
}

/** One component still wanted, and by whom. */
export interface NeedRow {
  name: string;
  island: string | null;
  dropsFrom: string | null;
  /** The still-unfinished quests that want it — one entry per quest, so the length is how many
   *  copies are needed. Fourteen components are wanted by two different classes, and a turn-in
   *  consumes the item, so one in the bag does not settle both. */
  wants: Array<{ code: string; quest: string }>;
  held: number;
}

/** Islands in the order you visit them. The label carries the number, so sorting on it is
 *  enough — except that Island 7 contributes both a named-mob group and a trash group, which
 *  the secondary sort on the label keeps adjacent and in a stable order. */
export function islandOrder(label: string | null): [number, string] {
  if (label === null) return [99, ""]; // no island listed — last
  const n = /^Island (\d+)/.exec(label);
  return [n ? Number(n[1]) : 98, label];
}

/**
 * What is still worth looking for, grouped by where it drops.
 *
 * Three things are deliberately left out, and each is a rule rather than a tidy-up:
 *   - **components of a finished quest** — the turn-in consumed them, and listing them sends
 *     you farming for a reward already in the bag;
 *   - **components held in sufficient number** — "sufficient" counts the quests that want it,
 *     not one, because a turn-in consumes the item and fourteen components are wanted twice;
 *   - **runes**, which are handed over by the quest giver rather than found.
 */
export function buildNeeds(catalogue: SkyClass[], held: Map<string, number>): Array<[string | null, NeedRow[]]> {
  const rows = new Map<string, NeedRow>();
  for (const c of catalogue) {
    for (const q of c.quests) {
      if (progressOf(q, held).state === "done") continue;
      for (const it of q.items) {
        const row = rows.get(it.name) ?? {
          name: it.name,
          island: it.island,
          dropsFrom: it.dropsFrom,
          wants: [],
          held: held.get(it.name) ?? 0,
        };
        row.wants.push({ code: c.code, quest: q.quest });
        rows.set(it.name, row);
      }
    }
  }

  const byIsland = new Map<string | null, NeedRow[]>();
  for (const r of rows.values()) {
    if (r.held >= r.wants.length) continue;
    const list = byIsland.get(r.island);
    if (list) list.push(r);
    else byIsland.set(r.island, [r]);
  }

  for (const list of byIsland.values()) {
    // Most-wanted first: a component two classes need is the one worth recognising on sight.
    list.sort((a, b) => b.wants.length - a.wants.length || a.name.localeCompare(b.name));
  }

  return [...byIsland].sort(([a], [b]) => {
    const [an, al] = islandOrder(a);
    const [bn, bl] = islandOrder(b);
    return an - bn || al.localeCompare(bl);
  });
}
