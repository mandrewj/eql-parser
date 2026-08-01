import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNeeds, islandOrder, progressOf } from "./sky-model.js";
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

// --- what is still needed ----------------------------------------------------

test("needs — components of a finished quest are not still needed", () => {
  const cat = [cls("WAR", [quest()])];
  assert.equal(buildNeeds(cat, holding({})).length, 1);
  // Reward in hand: the turn-in consumed the ring, so nothing about it is outstanding.
  assert.deepEqual(buildNeeds(cat, holding({ "Azure Ruby Ring": 1 })), []);
});

/** A turn-in consumes the item, so "do I have one" is the wrong test when two classes want it —
 *  and fourteen of the catalogue's components are wanted twice. */
test("needs — an item wanted by two quests needs two, and one in hand is not enough", () => {
  const cat = [
    cls("BST", [quest({ quest: "BST test", items: [item("Leather Cord")], rewards: ["A"] })]),
    cls("SHM", [quest({ quest: "SHM test", items: [item("Leather Cord")], rewards: ["B"] })]),
  ];

  const one = buildNeeds(cat, holding({ "Leather Cord": 1 }));
  const row = one[0]![1][0]!;
  assert.equal(row.wants.length, 2);
  assert.equal(row.held, 1);
  assert.deepEqual(
    row.wants.map((w) => w.code),
    ["BST", "SHM"],
  );

  // Two in hand settles both, and it leaves the list entirely.
  assert.deepEqual(buildNeeds(cat, holding({ "Leather Cord": 2 })), []);
});

test("needs — rows are grouped by island and islands come out in visiting order", () => {
  const cat = [
    cls("WAR", [
      quest({ quest: "a", items: [item("Late", "Island 8 — Veeshan")], rewards: ["ra"] }),
      quest({ quest: "b", items: [item("Early", "Island 2 — Azarack")], rewards: ["rb"] }),
      quest({ quest: "c", items: [item("Unplaced", null)], rewards: ["rc"] }),
    ]),
  ];
  assert.deepEqual(
    buildNeeds(cat, holding({})).map(([island]) => island),
    ["Island 2 — Azarack", "Island 8 — Veeshan", null],
  );
});

test("needs — within an island the most-wanted component sorts first", () => {
  const cat = [
    cls("WAR", [quest({ quest: "a", items: [item("Shared"), item("Solo")], rewards: ["ra"] })]),
    cls("MNK", [quest({ quest: "b", items: [item("Shared")], rewards: ["rb"] })]),
  ];
  const rows = buildNeeds(cat, holding({}))[0]![1];
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Shared", "Solo"],
  );
});

test("island order — the two Island 7 groups stay adjacent and stably ordered", () => {
  const labels = ["Island 7 — trash", "Island 7 — Drake", "Island 6 — Bee"];
  labels.sort((a, b) => {
    const [an, al] = islandOrder(a);
    const [bn, bl] = islandOrder(b);
    return an - bn || al.localeCompare(bl);
  });
  assert.deepEqual(labels, ["Island 6 — Bee", "Island 7 — Drake", "Island 7 — trash"]);
});
