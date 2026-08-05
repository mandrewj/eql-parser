import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIslands,
  completedQuestNames,
  groupByMob,
  islandOrder,
  primaryMob,
  progressOf,
  readyQuests,
  recentCompletions,
  RECENT_COMPLETIONS,
  RUNE_GROUP,
  RUNE_SOURCE,
  type NeedRow,
} from "./sky-model.js";
import type { SkyClass, SkyQuest } from "./types.js";

const item = (name: string, island: string | null = "Island 3 — Harpy") => ({
  name,
  island,
  dropsFrom: null,
});

const quest = (over: Partial<SkyQuest> = {}): SkyQuest => ({
  quest: "Test of Thing",
  trigger: "thing",
  rune: "Wind Rune Meda",
  items: [item("Azure Ring")],
  rewards: ["Azure Ruby Ring"],
  ...over,
});

const cls = (code: string, quests: SkyQuest[]): SkyClass => ({
  className: code,
  code,
  giver: "Someone",
  quests,
});

const holding = (o: Record<string, number>) => new Map(Object.entries(o));

// --- quest state -------------------------------------------------------------

test("state — holding the reward is what makes a quest done, not holding the parts", () => {
  assert.equal(progressOf(quest(), holding({ "Azure Ruby Ring": 1 })).state, "done");
  assert.equal(progressOf(quest(), holding({ "Azure Ring": 1, "Wind Rune Meda": 1 })).state, "ready");
  assert.equal(progressOf(quest(), holding({})).state, "open");
});

/** The bug this test exists for: the rune was treated as a formality the giver would hand over,
 *  so a quest a rune short reported itself ready to turn in. The wiki is explicit that runes
 *  "drop from all mobs in the Plane of Sky" — they are looted and must be in the bag. */
test("state — a quest one rune short is not ready", () => {
  const p = progressOf(quest(), holding({ "Azure Ring": 1 }));
  assert.equal(p.state, "partial");
  assert.equal(p.runeHeld, false);
  assert.equal(p.have, 1);
  assert.equal(p.need, 2); // the rune counts
});

test("state — the rune alone is progress, not readiness", () => {
  const p = progressOf(quest(), holding({ "Wind Rune Meda": 1 }));
  assert.equal(p.state, "partial");
  assert.equal(p.runeHeld, true);
  assert.equal(p.have, 1);
});

test("state — partial when only some parts are in hand", () => {
  const q = quest({ items: [item("Azure Ring"), item("Stone Amulet")] });
  const p = progressOf(q, holding({ "Azure Ring": 1 }));
  assert.equal(p.state, "partial");
  assert.equal(p.have, 1);
  assert.equal(p.need, 3); // rune + two components
});

/** Beastlord's Test of Claw awards a weapon for each hand. Holding one is not a finished quest,
 *  and treating it as one would hide the other from every view. */
test("state — a two-reward quest needs both rewards to count as done", () => {
  const q = quest({ rewards: ["Windhowl", "Spirit Render"] });
  assert.notEqual(progressOf(q, holding({ Windhowl: 1 })).state, "done");
  assert.equal(progressOf(q, holding({ Windhowl: 1, "Spirit Render": 1 })).state, "done");
});

test("state — a two-reward quest is done only once both are held, rune spent or not", () => {
  const q = quest({ rewards: ["Windhowl", "Spirit Render"] });
  assert.equal(progressOf(q, holding({ Windhowl: 1, "Spirit Render": 1 })).state, "done");
});

// --- every component of an island, and where it stands ------------------------

/** Pick one island out by name — index 0 is the rune group now, not a place. */
const islandOf = (islands: ReturnType<typeof buildIslands>, island: string | null) =>
  islands.find((x) => x.island === island)!;

/** Find one island's rows regardless of how they are grouped. */
const rowsOf = (islands: ReturnType<typeof buildIslands>, island: string | null): NeedRow[] => {
  const i = islandOf(islands, island);
  return [...i.outstanding.flatMap((g) => g.rows), ...i.settled];
};

const HARPY = "Island 3 — Harpy"; // where the default fixture's components drop

/** The point of the rework: a settled component stays on its island. Dropping it made
 *  "this island wants nothing more" indistinguishable from "this island was never listed". */
test("islands — a finished quest's component stays, marked done and sorted below", () => {
  const cat = [cls("WAR", [quest()])];

  const open = islandOf(buildIslands(cat, holding({})), HARPY);
  assert.equal(open.needCount, 1);
  assert.equal(open.settledCount, 0);

  // Reward in hand: the turn-in consumed the ring, so nothing is outstanding — but it is still
  // listed, as settled.
  const done = islandOf(buildIslands(cat, holding({ "Azure Ruby Ring": 1 })), HARPY);
  assert.equal(done.needCount, 0);
  assert.deepEqual(done.outstanding, []);
  assert.equal(done.settled.length, 1);
  assert.equal(done.settled[0]!.name, "Azure Ring");
  assert.equal(done.settled[0]!.state, "done");
  assert.equal(done.settled[0]!.need, 0);
});

test("islands — holding enough moves a row to settled without calling it done", () => {
  const cat = [cls("WAR", [quest()])];
  const isl = islandOf(buildIslands(cat, holding({ "Azure Ring": 1 })), HARPY);
  assert.equal(isl.needCount, 0);
  assert.equal(isl.settled[0]!.state, "held");
  assert.equal(isl.settled[0]!.held, 1);
  assert.equal(isl.settled[0]!.need, 1);
});

/** A turn-in consumes the item, so "do I have one" is the wrong test when two classes want it —
 *  and fourteen of the catalogue's components are wanted twice. */
test("islands — an item wanted by two quests needs two, and one in hand is not enough", () => {
  const cat = [
    cls("BST", [quest({ quest: "BST test", items: [item("Leather Cord")], rewards: ["A"] })]),
    cls("SHM", [quest({ quest: "SHM test", items: [item("Leather Cord")], rewards: ["B"] })]),
  ];

  const one = islandOf(buildIslands(cat, holding({ "Leather Cord": 1 })), HARPY);
  const row = one.outstanding[0]!.rows[0]!;
  assert.equal(row.state, "needed");
  assert.equal(row.need, 2);
  assert.equal(row.held, 1);
  assert.deepEqual(row.wants.map((w) => w.code), ["BST", "SHM"]);

  // Two in hand settles both.
  assert.equal(islandOf(buildIslands(cat, holding({ "Leather Cord": 2 })), HARPY).settled[0]!.state, "held");
});

/** Finishing one of the two quests reduces what the item is *for*, so one copy now suffices —
 *  the count has to follow the unfinished quests, not the total. */
test("islands — a finished quest stops asking for its share of a shared component", () => {
  const cat = [
    cls("BST", [quest({ quest: "BST test", items: [item("Leather Cord")], rewards: ["A"] })]),
    cls("SHM", [quest({ quest: "SHM test", items: [item("Leather Cord")], rewards: ["B"] })]),
  ];
  const isl = islandOf(buildIslands(cat, holding({ "Leather Cord": 1, A: 1 })), HARPY);
  const row = isl.settled[0]!;
  assert.equal(row.need, 1); // only the Shaman quest still wants one
  assert.equal(row.state, "held");
  assert.deepEqual(row.wants.map((w) => w.done), [true, false]);
});

/** Runes are farmed like everything else, so they are rows — in a group of their own, because
 *  they drop everywhere and filing them under one island would be a claim the wiki contradicts. */
test("islands — runes get their own group and it sorts first", () => {
  const cat = [cls("WAR", [quest()])];
  const islands = buildIslands(cat, holding({}));
  assert.equal(islands[0]!.island, RUNE_GROUP);
  const rune = islands[0]!.outstanding[0]!;
  assert.equal(rune.mob, RUNE_SOURCE);
  assert.equal(rune.rows[0]!.name, "Wind Rune Meda");
});

test("islands — one rune wanted by several quests needs one copy each", () => {
  const cat = [
    cls("WAR", [quest({ quest: "a", rewards: ["ra"] })]),
    cls("MNK", [quest({ quest: "b", rewards: ["rb"] })]),
  ];
  const runes = islandOf(buildIslands(cat, holding({ "Wind Rune Meda": 1 })), RUNE_GROUP);
  const row = runes.outstanding[0]!.rows[0]!;
  assert.equal(row.need, 2);
  assert.equal(row.held, 1);
  assert.equal(row.state, "needed");
});

test("islands — islands come out in visiting order, unplaced last", () => {
  const cat = [
    cls("WAR", [
      quest({ quest: "a", items: [item("Late", "Island 8 — Veeshan")], rewards: ["ra"] }),
      quest({ quest: "b", items: [item("Early", "Island 2 — Azarack")], rewards: ["rb"] }),
      quest({ quest: "c", items: [item("Unplaced", null)], rewards: ["rc"] }),
    ]),
  ];
  assert.deepEqual(
    buildIslands(cat, holding({})).map((i) => i.island),
    [RUNE_GROUP, "Island 2 — Azarack", "Island 8 — Veeshan", null],
  );
});

test("islands — within an island the most-wanted component sorts first", () => {
  const cat = [
    cls("WAR", [quest({ quest: "a", items: [item("Shared"), item("Solo")], rewards: ["ra"] })]),
    cls("MNK", [quest({ quest: "b", items: [item("Shared")], rewards: ["rb"] })]),
  ];
  assert.deepEqual(
    rowsOf(buildIslands(cat, holding({})), "Island 3 — Harpy").map((r) => r.name),
    ["Shared", "Solo"],
  );
});

test("islands — held sorts above turned-in within the settled block", () => {
  const cat = [
    cls("WAR", [
      quest({ quest: "a", items: [item("StillHave")], rewards: ["ra"] }),
      quest({ quest: "b", items: [item("SpentIt")], rewards: ["rb"] }),
    ]),
  ];
  const isl = islandOf(buildIslands(cat, holding({ StillHave: 1, rb: 1 })), HARPY);
  assert.deepEqual(
    isl.settled.map((r) => [r.name, r.state]),
    [
      ["StillHave", "held"],
      ["SpentIt", "done"],
    ],
  );
});

/** Island 7 contributes both a named-mob group and a trash group, and they must stay adjacent
 *  and in a stable order rather than sorting apart on their labels. */
test("island order — the two Island 7 groups stay adjacent and stably ordered", () => {
  const labels = ["Island 7 — trash", "Island 7 — Drake", "Island 6 — Bee"];
  labels.sort((a, b) => {
    const [an, al] = islandOrder(a);
    const [bn, bl] = islandOrder(b);
    return an - bn || al.localeCompare(bl);
  });
  assert.deepEqual(labels, ["Island 6 — Bee", "Island 7 — Drake", "Island 7 — trash"]);
});

// --- grouping by the mob that drops it ---------------------------------------

test("primary mob — the first named, with a trailing parenthetical dropped", () => {
  assert.equal(primaryMob("Noble Dojorn, Overseer of Air"), "Noble Dojorn");
  assert.equal(primaryMob("Bazzt Zzzt (Island 6 Boss)"), "Bazzt Zzzt");
  assert.equal(primaryMob(null), null);
});

/** Grouping on the whole string fragments one boss into several headings — the Efreeti items
 *  alone spread across eight variants of "Noble Dojorn, …". */
test("group by mob — variants of one mob's list collapse to one heading", () => {
  const mk = (name: string, from: string): NeedRow => ({
    name, island: null, dropsFrom: from, wants: [], need: 1, held: 0, state: "needed",
  });
  const rows = [
    mk("a", "Noble Dojorn, Overseer of Air"),
    mk("b", "Noble Dojorn"),
    mk("c", "Noble Dojorn, The Hand of Veeshan"),
  ];
  const g = groupByMob(rows);
  assert.equal(g.length, 1);
  assert.equal(g[0]!.mob, "Noble Dojorn");
  assert.equal(g[0]!.rows.length, 3);
});

test("group by mob — biggest debt first, and the unsourced group always last", () => {
  const row = (name: string, from: string | null): NeedRow => ({
    name, island: null, dropsFrom: from, wants: [], need: 1, held: 0, state: "needed",
  });
  const g = groupByMob([row("a", null), row("b", "Small Fry"), row("c", "Big Boss"), row("d", "Big Boss")]);
  assert.deepEqual(
    g.map((x) => x.mob),
    ["Big Boss", "Small Fry", null],
  );
});

// --- the progress box --------------------------------------------------------

test("ready — every component held, reward not yet", () => {
  const cat = [
    cls("DRU", [
      quest({ quest: "ready one", items: [item("Storm Sky Opal")], rewards: ["Espri"] }),
      quest({ quest: "not ready", items: [item("Ethereal Ruby")], rewards: ["Focus"] }),
      quest({ quest: "already done", items: [item("Worn Leather Mask")], rewards: ["Drake-Hide Mask"] }),
    ]),
  ];
  // The rune counts, so it has to be held for anything to be ready.
  const held = holding({
    "Wind Rune Meda": 1,
    "Storm Sky Opal": 1,
    "Worn Leather Mask": 1,
    "Drake-Hide Mask": 1,
  });
  assert.deepEqual(
    readyQuests(cat, held).map((r) => r.quest.quest),
    ["ready one"],
  );
  // Take the rune away and nothing is ready, however many components are in the bag.
  assert.deepEqual(readyQuests(cat, holding({ "Storm Sky Opal": 1 })), []);
});

test("completions — a reward resolves back to its quest and class", () => {
  const cat = [cls("WAR", [quest({ quest: "Warrior Test of Skill", rewards: ["Azure Ruby Ring"] })])];
  const out = recentCompletions(cat, [{ reward: "Azure Ruby Ring", tsMs: 1000, quest: null }]).shown;
  assert.equal(out.length, 1);
  assert.equal(out[0]!.quest, "Warrior Test of Skill");
  assert.equal(out[0]!.code, "WAR");
});

/** The log hands over plenty that is nothing to do with Sky — a real one has three
 *  `You have been given: Void-Touched Potential`. Those must not appear as completions. */
test("completions — an item that is no quest reward is dropped, not shown bare", () => {
  const cat = [cls("WAR", [quest()])];
  assert.deepEqual(recentCompletions(cat, [{ reward: "Void-Touched Potential", tsMs: 1000, quest: null }]).shown, []);
});

/** A long Sky session turns in a steady stream, and every completed row pushes the actionable
 *  half of the box — what is ready to hand in — further down the panel. */
test("completions — the recent list is capped, newest first", () => {
  const quests = [];
  const completed = [];
  for (let i = 0; i < 14; i++) {
    quests.push(quest({ quest: `Test ${i}`, rewards: [`Reward ${i}`] }));
    completed.push({ reward: `Reward ${i}`, tsMs: 1000 + i, quest: null });
  }
  const { shown, more } = recentCompletions([cls("WAR", quests)], completed);
  assert.equal(shown.length, RECENT_COMPLETIONS);
  assert.equal(more, 4);
  assert.equal(shown[0]!.quest, "Test 13", "newest first");
  assert.equal(shown[9]!.quest, "Test 4", "…down to the tenth-newest");
});

test("completions — under the cap, nothing is held back", () => {
  const cat = [cls("WAR", [quest({ quest: "Warrior Test", rewards: ["Azure Ruby Ring"] })])];
  const { shown, more } = recentCompletions(cat, [{ reward: "Azure Ruby Ring", tsMs: 1000, quest: null }]);
  assert.equal(shown.length, 1);
  assert.equal(more, 0);
});

/** The "+N earlier" note counts rows that *would* have been listed, so it cannot be derived from
 *  the raw array — a handover that is no quest reward never belonged on the list at all. */
test("completions — the held-back count ignores rewards that are not quest rewards", () => {
  const quests = [];
  const completed = [];
  for (let i = 0; i < 11; i++) {
    quests.push(quest({ quest: `Test ${i}`, rewards: [`Reward ${i}`] }));
    completed.push({ reward: `Reward ${i}`, tsMs: 1000 + i, quest: null });
  }
  completed.push({ reward: "Void-Touched Potential", tsMs: 9999, quest: null });
  const { shown, more } = recentCompletions([cls("WAR", quests)], completed);
  assert.equal(shown.length, RECENT_COMPLETIONS);
  assert.equal(more, 1, "eleven real completions, ten shown — the junk handover counts for nothing");
});

/** The regression the cap could have caused, and the reason it is display-only: the same
 *  `completed` array marks quests ✓ across the class and island views. Capping what reaches
 *  `completedQuestNames` would un-finish every turn-in past the tenth, sending you back to an
 *  NPC who has nothing left for you. */
test("completions — capping the list does not un-finish the older quests", () => {
  const quests = [];
  const completed = [];
  for (let i = 0; i < 14; i++) {
    quests.push(quest({ quest: `Test ${i}`, rewards: [`Reward ${i}`] }));
    completed.push({ reward: `Reward ${i}`, tsMs: 1000 + i, quest: null });
  }
  const cat = [cls("WAR", quests)];
  const names = completedQuestNames(cat, completed);
  assert.equal(names.size, 14, "every turn-in still counts as finished");
  // The oldest one is off the list and still done — with nothing at all in the bags.
  assert.equal(names.has("Test 0"), true);
  assert.equal(progressOf(quests[0]!, holding({}), names).state, "done");
  assert.equal(recentCompletions(cat, completed).shown.some((c) => c.quest === "Test 0"), false);
});
