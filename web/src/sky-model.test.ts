import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIslands,
  groupByMob,
  islandOrder,
  primaryMob,
  progressOf,
  readyQuests,
  resolveCompletions,
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
  assert.equal(progressOf(quest(), holding({ "Azure Ring": 1 })).state, "ready");
  assert.equal(progressOf(quest(), holding({})).state, "open");
});

test("state — partial when only some components are in hand", () => {
  const q = quest({ items: [item("Azure Ring"), item("Stone Amulet")] });
  const p = progressOf(q, holding({ "Azure Ring": 1 }));
  assert.equal(p.state, "partial");
  assert.equal(p.have, 1);
  assert.equal(p.need, 2);
});

/** Beastlord's Test of Claw awards a weapon for each hand. Holding one is not a finished quest,
 *  and treating it as one would hide the other from every view. */
test("state — a two-reward quest needs both rewards to count as done", () => {
  const q = quest({ rewards: ["Windhowl", "Spirit Render"] });
  assert.notEqual(progressOf(q, holding({ Windhowl: 1 })).state, "done");
  assert.equal(progressOf(q, holding({ Windhowl: 1, "Spirit Render": 1 })).state, "done");
});

test("state — the rune is tracked but does not count toward the components", () => {
  const p = progressOf(quest(), holding({ "Wind Rune Meda": 1 }));
  assert.equal(p.runeHeld, true);
  assert.equal(p.have, 0);
  assert.equal(p.state, "open");
});

// --- every component of an island, and where it stands ------------------------

/** Find one island's rows regardless of how they are grouped. */
const rowsOf = (islands: ReturnType<typeof buildIslands>, island: string | null): NeedRow[] => {
  const i = islands.find((x) => x.island === island)!;
  return [...i.outstanding.flatMap((g) => g.rows), ...i.settled];
};

/** The point of the rework: a settled component stays on its island. Dropping it made
 *  "this island wants nothing more" indistinguishable from "this island was never listed". */
test("islands — a finished quest's component stays, marked done and sorted below", () => {
  const cat = [cls("WAR", [quest()])];

  const open = buildIslands(cat, holding({}))[0]!;
  assert.equal(open.needCount, 1);
  assert.equal(open.settledCount, 0);

  // Reward in hand: the turn-in consumed the ring, so nothing is outstanding — but it is still
  // listed, as settled.
  const done = buildIslands(cat, holding({ "Azure Ruby Ring": 1 }))[0]!;
  assert.equal(done.needCount, 0);
  assert.deepEqual(done.outstanding, []);
  assert.equal(done.settled.length, 1);
  assert.equal(done.settled[0]!.name, "Azure Ring");
  assert.equal(done.settled[0]!.state, "done");
  assert.equal(done.settled[0]!.need, 0);
});

test("islands — holding enough moves a row to settled without calling it done", () => {
  const cat = [cls("WAR", [quest()])];
  const isl = buildIslands(cat, holding({ "Azure Ring": 1 }))[0]!;
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

  const one = buildIslands(cat, holding({ "Leather Cord": 1 }))[0]!;
  const row = one.outstanding[0]!.rows[0]!;
  assert.equal(row.state, "needed");
  assert.equal(row.need, 2);
  assert.equal(row.held, 1);
  assert.deepEqual(row.wants.map((w) => w.code), ["BST", "SHM"]);

  // Two in hand settles both.
  assert.equal(buildIslands(cat, holding({ "Leather Cord": 2 }))[0]!.settled[0]!.state, "held");
});

/** Finishing one of the two quests reduces what the item is *for*, so one copy now suffices —
 *  the count has to follow the unfinished quests, not the total. */
test("islands — a finished quest stops asking for its share of a shared component", () => {
  const cat = [
    cls("BST", [quest({ quest: "BST test", items: [item("Leather Cord")], rewards: ["A"] })]),
    cls("SHM", [quest({ quest: "SHM test", items: [item("Leather Cord")], rewards: ["B"] })]),
  ];
  const isl = buildIslands(cat, holding({ "Leather Cord": 1, A: 1 }))[0]!;
  const row = isl.settled[0]!;
  assert.equal(row.need, 1); // only the Shaman quest still wants one
  assert.equal(row.state, "held");
  assert.deepEqual(row.wants.map((w) => w.done), [true, false]);
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
    ["Island 2 — Azarack", "Island 8 — Veeshan", null],
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
  const isl = buildIslands(cat, holding({ StillHave: 1, rb: 1 }))[0]!;
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
  const held = holding({ "Storm Sky Opal": 1, "Worn Leather Mask": 1, "Drake-Hide Mask": 1 });
  assert.deepEqual(
    readyQuests(cat, held).map((r) => r.quest.quest),
    ["ready one"],
  );
});

test("completions — a reward resolves back to its quest and class", () => {
  const cat = [cls("WAR", [quest({ quest: "Warrior Test of Skill", rewards: ["Azure Ruby Ring"] })])];
  const out = resolveCompletions(cat, [{ reward: "Azure Ruby Ring", tsMs: 1000 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.quest, "Warrior Test of Skill");
  assert.equal(out[0]!.code, "WAR");
});

/** The log hands over plenty that is nothing to do with Sky — a real one has three
 *  `You have been given: Void-Touched Potential`. Those must not appear as completions. */
test("completions — an item that is no quest reward is dropped, not shown bare", () => {
  const cat = [cls("WAR", [quest()])];
  assert.deepEqual(resolveCompletions(cat, [{ reward: "Void-Touched Potential", tsMs: 1000 }]), []);
});
