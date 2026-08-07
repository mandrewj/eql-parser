// The Plane of Sky tracker's arithmetic, kept apart from the panel that draws it.
//
// Same split as `stats.ts` against `components.tsx`: these are the rules that decide what is
// finished and what is still worth farming, and they are worth testing without a renderer.

import type { SkyClass, SkyCompletion, SkyQuest } from "./types";

/** Quests the log saw handed in. Completion is an event, so it outlives holding the reward. */
export type CompletedSet = ReadonlySet<string>;

/** Where a quest stands. Derived rather than stored — there is no persistence in this app, and
 *  the whole state is a function of the inventory export and the log. */
export type QuestState = "done" | "ready" | "partial" | "open";

/** Where the Wind Runes come from, in the wiki's own words: "The wind runes drop from all mobs
 *  in the Plane of Sky, and many players simply farm the trash mobs on one of the early
 *  islands." They are turn-in components like any other and have to be **in the bag**. */
export const RUNE_SOURCE = "any mob in the Plane of Sky";
/** Runes drop everywhere, so filing them under one island would be a claim the wiki contradicts.
 *  They get a group of their own, and it sorts first — it is the thing you can farm while doing
 *  anything else. */
export const RUNE_GROUP = "Wind Runes";

/** The wiki tags the Efreeti items with no island, which is not a gap in the data — they are not
 *  *on* an island. They drop from the Efreeti cycle, so the panel files them under its name
 *  rather than under the absence of one: "No island listed" described the wiki's table, and this
 *  describes where you go. Sorted last, as the unlabelled group already was. */
export const EFREETI_CYCLE = "Efreeti Cycle";

/** One heading for the whole cycle, rather than one per mob. The wiki names a different subset of
 *  the three for nearly every item — "Noble Dojorn", "Noble Dojorn, Overseer of Air", "The Hand of
 *  Veeshan, Noble Dojorn, Overseer of Air" — which split the cycle into headings that were really
 *  one thing. You run the cycle; you do not pick which of the three to kill. Each row's full source
 *  list stays in its tooltip, so nothing is hidden by the shared heading. */
export const EFREETI_MOBS = "Dojorn / Overseer / Hand";

export interface QuestProgress {
  state: QuestState;
  /** Everything the turn-in wants, held / total — **including the rune**. */
  have: number;
  need: number;
  runeHeld: boolean;
}

/** Everything a turn-in consumes: the rune and the components, with no privileged member.
 *  The rune was once treated as a formality the quest giver would hand over on request; it is
 *  not, it is looted like the rest, and leaving it out declared quests ready that were a rune
 *  short. */
function questParts(quest: SkyQuest): string[] {
  return [quest.rune, ...quest.items.map((i) => i.name)];
}

export function progressOf(
  quest: SkyQuest,
  held: Map<string, number>,
  completed?: CompletedSet,
): QuestProgress {
  const parts = questParts(quest);
  const have = parts.filter((n) => held.has(n)).length;
  const need = parts.length;
  // **A completion is permanent.** Holding the reward is only the fallback test — rewards get
  // banked, worn on another character or sold, and none of that un-finishes the quest. The log
  // saw the turn-in, so that is what the answer rests on when it is available.
  const done =
    completed?.has(quest.quest) === true ||
    (quest.rewards.length > 0 && quest.rewards.every((r) => held.has(r)));
  const state: QuestState = done ? "done" : have === need && need > 0 ? "ready" : have > 0 ? "partial" : "open";
  return { state, have, need, runeHeld: held.has(quest.rune) };
}

/** Where a component stands on the island it drops on. The three are ordered by how much they
 *  ask of you, which is also the order they are listed in. */
export type NeedState =
  | "needed" // short of it, for at least one unfinished quest
  | "held" // enough in hand to settle every unfinished quest that wants it
  | "done"; // every quest that wanted it is finished; the turn-in consumed it

/** One component of an island, and who wants it. */
export interface NeedRow {
  name: string;
  /** Never null: an item the wiki left untagged is filed under `EFREETI_CYCLE`. */
  island: string;
  dropsFrom: string | null;
  /** Every quest wanting it, finished or not — one entry per quest. Fourteen components are
   *  wanted by two different classes, and a turn-in consumes the item, so one in the bag does
   *  not settle both. `done` marks the ones already turned in, which no longer ask for a copy. */
  wants: Array<{ code: string; quest: string; done: boolean }>;
  /** How many copies the *unfinished* quests still call for. Zero means the item's work is over. */
  need: number;
  held: number;
  state: NeedState;
}

/** Islands in the order you visit them. The label carries the number, so sorting on it is
 *  enough — except that Island 7 contributes both a named-mob group and a trash group, which
 *  the secondary sort on the label keeps adjacent and in a stable order. */
export function islandOrder(label: string): [number, string] {
  if (label === EFREETI_CYCLE) return [99, label]; // not on an island at all — last
  if (label === RUNE_GROUP) return [0, label]; // farmable anywhere, so it leads
  const n = /^Island (\d+)/.exec(label);
  return [n ? Number(n[1]) : 98, label];
}

/** The mob a row is filed under. The wiki often lists several, in no fixed order, and grouping
 *  on the whole string fragments one boss into four headings — the Efreeti items alone spread
 *  across eight variants of "Noble Dojorn, …". The **first** named is taken as the primary
 *  source, and a trailing parenthetical is dropped so `Bazzt Zzzt (Island 6 Boss)` files with
 *  `Bazzt Zzzt`. The full list stays in the row's tooltip. */
export function primaryMob(dropsFrom: string | null): string | null {
  if (!dropsFrom) return null;
  const first = dropsFrom.split(",")[0]!.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return first || null;
}

/** An island's outstanding rows, gathered under the mob that drops them. */
export interface MobGroup {
  mob: string | null; // null → the wiki names no source
  rows: NeedRow[];
}

/** One island: what is left to find, and what is already settled.
 *
 *  The two are kept apart rather than interleaved because they answer different questions. The
 *  outstanding rows are a plan — grouped by the mob that drops them, since that is what you kill.
 *  The settled ones are reassurance, and grouping *them* by mob would be answering "where would I
 *  farm this" about something there is no reason to farm. */
export interface IslandNeeds {
  island: string;
  outstanding: MobGroup[];
  settled: NeedRow[];
  /** Counts for the header: rows still short, and rows already answered. */
  needCount: number;
  settledCount: number;
}

/** Group one island's rows by their primary mob. Mobs are ordered by how much they owe you,
 *  since that is the order you would kill them in; the unsourced group always sorts last. */
export function groupByMob(rows: NeedRow[], singleGroup?: string): MobGroup[] {
  // One heading for the lot, when the caller knows the mobs are not a choice you make — the
  // Efreeti cycle, where the wiki's per-item source lists are subsets of the same three mobs.
  if (singleGroup) return rows.length ? [{ mob: singleGroup, rows }] : [];
  const byMob = new Map<string | null, NeedRow[]>();
  for (const r of rows) {
    const mob = primaryMob(r.dropsFrom);
    const list = byMob.get(mob);
    if (list) list.push(r);
    else byMob.set(mob, [r]);
  }
  return [...byMob]
    .map(([mob, rs]) => ({ mob, rows: rs }))
    .sort((a, b) => {
      if (a.mob === null) return 1;
      if (b.mob === null) return -1;
      return b.rows.length - a.rows.length || a.mob.localeCompare(b.mob);
    });
}

/** A quest whose components are all in hand — go and see the NPC. */
export interface ReadyQuest {
  code: string;
  className: string;
  giver: string;
  quest: SkyQuest;
}

/** Everything ready to turn in, across all 16 classes. */
export function readyQuests(
  catalogue: SkyClass[],
  held: Map<string, number>,
  completed?: CompletedSet,
): ReadyQuest[] {
  const out: ReadyQuest[] = [];
  for (const c of catalogue) {
    for (const q of c.quests) {
      if (progressOf(q, held, completed).state === "ready") {
        out.push({ code: c.code, className: c.className, giver: c.giver, quest: q });
      }
    }
  }
  return out;
}

/** A dated completion, resolved back to the quest it finished. Reward names are unique across
 *  the catalogue, so the reward alone identifies it — which is why the snapshot carries only
 *  the reward and the date. An unrecognised reward is dropped rather than shown bare. */
export interface ResolvedCompletion {
  tsMs: number;
  reward: string;
  code: string;
  className: string;
  quest: string;
}

/** The quest names the log saw finished, for `progressOf`. */
export function completedQuestNames(catalogue: SkyClass[], completed: SkyCompletion[]): Set<string> {
  const byReward = new Map<string, string>();
  for (const c of catalogue) for (const q of c.quests) for (const r of q.rewards) byReward.set(r, q.quest);
  const out = new Set<string>();
  for (const c of completed) {
    const name = c.quest ?? byReward.get(c.reward);
    if (name) out.add(name);
  }
  return out;
}

/** How many finished quests the "Recently complete" list shows. A long Sky session turns in a
 *  steady stream of them, and every row pushes the *actionable* half of the box — what is ready
 *  to hand in — further down the panel. Ten is enough to cover a sitting and still leave the
 *  ready list on screen.
 *
 *  **Display only, and it has to be.** The same `completed` array feeds `completedQuestNames`,
 *  which is what marks a quest ✓ in the class and island views. Capping the list that reaches
 *  *that* would un-finish every turn-in past the tenth — quests already handed in would read as
 *  ready again, and the panel would send you back to an NPC who has nothing left for you. */
export const RECENT_COMPLETIONS = 10;

/** The completions to list, newest first, and how many older ones are being held back. Returning
 *  the count rather than the rows keeps the "+N earlier" note honest: unrecognised rewards are
 *  dropped by `resolveCompletions`, so it is not `completed.length` minus the cap. */
export function recentCompletions(
  catalogue: SkyClass[],
  completed: SkyCompletion[],
  limit = RECENT_COMPLETIONS,
): { shown: ResolvedCompletion[]; more: number } {
  const all = resolveCompletions(catalogue, completed);
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/** Not exported: `recentCompletions` is the only caller, and an export whose sole reader is a
 *  test is the finding past audits here have turned up three times. The behaviour below is
 *  reachable — and is tested — through that function. */
function resolveCompletions(catalogue: SkyClass[], completed: SkyCompletion[]): ResolvedCompletion[] {
  const byReward = new Map<string, { code: string; className: string; quest: string }>();
  for (const c of catalogue) {
    for (const q of c.quests) {
      for (const r of q.rewards) byReward.set(r, { code: c.code, className: c.className, quest: q.quest });
    }
  }
  const out: ResolvedCompletion[] = [];
  for (const c of completed) {
    const hit = byReward.get(c.reward);
    if (hit) out.push({ tsMs: c.tsMs, reward: c.reward, ...hit });
  }
  out.sort((a, b) => b.tsMs - a.tsMs);
  return out;
}

/**
 * Every component of every island — and the runes — and where each stands.
 *
 * **Nothing is dropped any more.** An earlier cut excluded a component the moment it was
 * settled — enough in hand, or its quests all finished — which kept the list to a plan but made
 * the island unreadable as a place: you could not tell "Island 5 wants nothing more from me"
 * from "Island 5 was never in the list". Settled rows are kept and sorted to the bottom.
 *
 * Three states, and the arithmetic that separates them:
 *   - `need` counts only the **unfinished** quests wanting the item, because a turn-in consumes
 *     its components — a finished quest asks for nothing further;
 *   - `need === 0` is `done`: every quest that ever wanted it is complete;
 *   - `held >= need` is `held`: enough in hand to settle what is left, so nothing to farm;
 *   - anything else is `needed`.
 *
 * Runes are included, in a group of their own. They were once left out on the belief that the
 * quest giver handed them over; the wiki says they "drop from all mobs in the Plane of Sky", so
 * they are farmed like everything else — and a rune is wanted by six quests on average, which
 * makes them the biggest single thing to farm rather than a detail.
 */
export function buildIslands(
  catalogue: SkyClass[],
  held: Map<string, number>,
  completed?: CompletedSet,
): IslandNeeds[] {
  const rows = new Map<string, NeedRow>();
  for (const c of catalogue) {
    const done = new Map<string, boolean>();
    for (const q of c.quests) done.set(q.quest, progressOf(q, held, completed).state === "done");
    for (const q of c.quests) {
      // The rune is one of the parts, so it is one of the rows — in a group of its own, since
      // it drops everywhere rather than on any one island.
      const parts = [
        { name: q.rune, island: RUNE_GROUP as string | null, dropsFrom: RUNE_SOURCE as string | null },
        ...q.items,
      ];
      for (const it of parts) {
        const row = rows.get(it.name) ?? {
          name: it.name,
          // An untagged item is an Efreeti-cycle item; the panel has a name for that place.
          island: it.island ?? EFREETI_CYCLE,
          dropsFrom: it.dropsFrom,
          wants: [],
          need: 0,
          held: held.get(it.name) ?? 0,
          state: "needed" as NeedState,
        };
        row.wants.push({ code: c.code, quest: q.quest, done: done.get(q.quest)! });
        rows.set(it.name, row);
      }
    }
  }

  const byIsland = new Map<string, NeedRow[]>();
  for (const r of rows.values()) {
    r.need = r.wants.filter((w) => !w.done).length;
    r.state = r.need === 0 ? "done" : r.held >= r.need ? "held" : "needed";
    const list = byIsland.get(r.island);
    if (list) list.push(r);
    else byIsland.set(r.island, [r]);
  }

  const out: IslandNeeds[] = [];
  for (const [island, list] of byIsland) {
    const outstanding = list.filter((r) => r.state === "needed");
    // Most-wanted first: a component two classes still need is the one worth recognising on sight.
    outstanding.sort((a, b) => b.need - a.need || a.name.localeCompare(b.name));
    // Held before done — one is a thing you have, the other a thing you no longer think about.
    const settled = list
      .filter((r) => r.state !== "needed")
      .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === "held" ? -1 : 1));
    out.push({
      island,
      outstanding: groupByMob(outstanding, island === EFREETI_CYCLE ? EFREETI_MOBS : undefined),
      settled,
      needCount: outstanding.length,
      settledCount: settled.length,
    });
  }

  return out.sort((a, b) => {
    const [an, al] = islandOrder(a.island);
    const [bn, bl] = islandOrder(b.island);
    return an - bn || al.localeCompare(bl);
  });
}
