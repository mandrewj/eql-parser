import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PARTIAL_WINDOW,
  THIN_SAMPLE,
  critAverages,
  critRate,
  critShare,
  THIN_CRITS,
  VISIBLE_ROWS,
  allRowsKey,
  foldEncounterCards,
  foldKeys,
  rowKey,
  isPartialWindow,
  isThinCrits,
  isThinSample,
  shownAbilities,
  weightedAvgDps,
} from "./stats.js";
import type { CritAbility, CritCategoryStat, EncounterCard, MetricStat, SelfEncounterPoint } from "./types.js";

/** A history point with only the fields the chart's average reads. */
const pt = (damage: number, durationSec: number): SelfEncounterPoint => ({
  id: `e${damage}`,
  name: "a mob",
  startMs: 0,
  endMs: durationSec * 1000,
  durationSec,
  damage,
  dps: Math.round(damage / durationSec),
  taken: 0,
  takenPerSec: 0,
  melee: "offensive",
  invocation: "spellblade",
});

test("weightedAvgDps weighs each encounter by its length, not one vote each", () => {
  // 100 damage in 2s (50 dps) beside 900 in 30s (30 dps).
  const points = [pt(100, 2), pt(900, 30)];
  assert.equal(weightedAvgDps(points), 31); // 1000 / 32s
  // The mean of the two rates — what this must never be — sits nine points higher,
  // because it lets a 2-second mob count as much as one fifteen times its length.
  assert.equal(Math.round((50 + 30) / 2), 40);
});

test("weightedAvgDps is the plain rate when every encounter is the same length", () => {
  assert.equal(weightedAvgDps([pt(100, 10), pt(300, 10)]), 20); // 400 / 20s
});

// --- the encounter table's fold ---------------------------------------------

/** An encounter card with only the fields the fold reads. */
const card = (name: string, total: number, isSelf = false): EncounterCard => {
  const nil: MetricStat = { total: 0, perSec: 0, hits: 0, crits: 0, avoided: 0, byType: { melee: 0, spell: 0, dot: 0, unknown: 0 }, entries: [] };
  return {
    name,
    kind: isSelf ? "self" : "player",
    isSelf,
    damage: { ...nil, total, perSec: total },
    healing: nil,
    taken: nil,
    activeSec: 10,
    pct: 0,
  };
};

/** Ten contributors ranked 100, 90, … 10, with me nowhere near the top. */
const raid = (selfDamage: number): EncounterCard[] => {
  const cards = Array.from({ length: 10 }, (_, i) => card(`P${i + 1}`, 100 - i * 10));
  return [...cards, card("Sanluen", selfDamage, true)].sort((a, b) => b.damage.total - a.damage.total);
};

test("the fold opens on the top six and keeps the rest", () => {
  const cards = raid(95); // I rank second, so nothing unusual happens
  const { lead, folded } = foldEncounterCards(cards, 645);
  assert.equal(lead.length, VISIBLE_ROWS);
  assert.deepEqual(lead.map((c) => c.name), ["P1", "Sanluen", "P2", "P3", "P4", "P5"]);
  assert.equal(folded.length, 5, "the tail is kept, not dropped");
  assert.deepEqual(folded.map((c) => c.name), ["P6", "P7", "P8", "P9", "P10"]);
});

test("my row is in the opening six however far down I rank", () => {
  const cards = raid(1); // dead last, as on a night spent healing
  const { lead, folded } = foldEncounterCards(cards, 551);
  assert.equal(lead.length, VISIBLE_ROWS, "still six rows — I displace the sixth, not add to it");
  assert.equal(lead.at(-1)!.name, "Sanluen", "and I sit in rank order at the bottom of them");
  assert.deepEqual(lead.map((c) => c.name), ["P1", "P2", "P3", "P4", "P5", "Sanluen"]);
  assert.ok(!folded.some((c) => c.isSelf), "never folded away");
  assert.equal(folded.length, 5);
  assert.deepEqual(folded.map((c) => c.name), ["P6", "P7", "P8", "P9", "P10"]);
});

test("the fold reports the tail's share of the encounter, not of itself", () => {
  const cards = raid(1);
  const { foldedTotal, foldedPct } = foldEncounterCards(cards, 551);
  assert.equal(foldedTotal, 50 + 40 + 30 + 20 + 10);
  assert.equal(foldedPct, 27.2); // 150 / 551 — one decimal, so a thin tail doesn't read as 0
});

test("no fold when everyone already fits, and none of them go missing", () => {
  const cards = [card("P1", 100), card("Sanluen", 40, true), card("P2", 10)];
  const { lead, folded, foldedPct } = foldEncounterCards(cards, 150);
  assert.equal(folded.length, 0, "nothing to expand to — the row hides");
  assert.equal(foldedPct, 0);
  assert.deepEqual(lead.map((c) => c.name), ["P1", "Sanluen", "P2"]);
});

test("the fold keeps the order it was given rather than ranking again", () => {
  // Deliberately not in damage order: whatever the engine sent is what the rows show, so a
  // second copy of the ranking rule here would have somewhere to disagree. If this ever fails
  // by "correcting" the order, the comparator has crept back in.
  const cards = [card("Last", 1), card("Sanluen", 5, true), card("First", 100), card("Mid", 50)];
  const { lead } = foldEncounterCards(cards, 156, 3);
  assert.deepEqual(lead.map((c) => c.name), ["Last", "Sanluen", "First"]);
});

test("the fold writes exactly the keys the rows read", () => {
  // The button opening every drill is only wired up if these two agree — and a mismatch is
  // silent: keys nobody reads, rows that never open, no error anywhere.
  const cards = raid(1);
  const keys = foldKeys("enc-7", cards);
  assert.equal(keys[0], allRowsKey("enc-7"), "the table's own key leads");
  assert.deepEqual(
    keys.slice(1),
    cards.map((c) => rowKey("enc-7", c.name)),
    "then one per contributor, the same key each row builds for itself",
  );
  assert.equal(new Set(keys).size, keys.length, "no duplicates to un-toggle each other");
});

test("the fold's sentinel cannot be mistaken for a row", () => {
  assert.ok(!raid(1).some((c) => rowKey("e", c.name) === allRowsKey("e")));
  // Both live in one panel-wide set, so the sentinel has to be something no mob is called.
  assert.equal(allRowsKey("enc-7"), "enc-7:*all*");
});

test("a fight I did not fight in still folds by rank", () => {
  const cards = Array.from({ length: 8 }, (_, i) => card(`P${i + 1}`, 100 - i * 10));
  const { lead, folded } = foldEncounterCards(cards, 520);
  assert.equal(lead.length, VISIBLE_ROWS, "no self row to hold, so six others fill it");
  assert.deepEqual(folded.map((c) => c.name), ["P7", "P8"]);
});

test("an encounter I did nothing in still spends its seconds", () => {
  assert.equal(weightedAvgDps([pt(600, 10)]), 60);
  assert.equal(weightedAvgDps([pt(600, 10), pt(0, 10)]), 30);
});

test("weightedAvgDps is 0 on an empty window rather than NaN", () => {
  assert.equal(weightedAvgDps([]), 0);
});

test("isPartialWindow flags only a real shortfall", () => {
  assert.equal(PARTIAL_WINDOW, 0.7);
  // The common case: engaged a second or two after the mob was first seen.
  assert.equal(isPartialWindow(33, 35), false);
  assert.equal(isPartialWindow(28, 35), false); // exactly 80%
  assert.equal(isPartialWindow(24, 35), true); // ~69%
  assert.equal(isPartialWindow(5, 31), true);
  // The threshold itself is not a shortfall.
  assert.equal(isPartialWindow(7, 10), false);
  assert.equal(isPartialWindow(6, 10), true);
});

// --- critical hits ---------------------------------------------------------------

const cat = (o: Partial<CritCategoryStat>): CritCategoryStat => ({
  category: "melee",
  hits: 0,
  crits: 0,
  total: 0,
  critTotal: 0,
  crittable: true,
  byKind: [],
  best: null,
  bestHit: null,
  abilities: [],
  ...o,
});

test("critRate divides crits by the hits that dealt damage", () => {
  assert.equal(critRate(cat({ hits: 200, crits: 16 })), 8);
});

test("critRate is null — not zero — for a form that cannot crit", () => {
  // The distinction the whole panel turns on: a damage shield that never crits and a spell
  // that rolled badly all session must not print the same number.
  assert.equal(critRate(cat({ hits: 39563, crits: 0, crittable: false })), null);
  assert.equal(critRate(cat({ hits: 39563, crits: 0, crittable: true })), 0);
  assert.equal(critRate(cat({ hits: 0, crits: 0 })), null, "nothing to divide");
});

test("critShare is the damage that arrived on a crit, not the count", () => {
  // Real melee figures: 8.34% of swings carried 12.46% of the damage. Both are the point.
  const c = cat({ hits: 131372, crits: 10954, total: 9849514, critTotal: 1227263 });
  assert.equal(Math.round(critRate(c)! * 100) / 100, 8.34);
  assert.equal(Math.round(critShare(c)! * 100) / 100, 12.46);
});

test("critAverages compares a crit against an ordinary hit", () => {
  const { crit, normal, multiple } = critAverages(cat({ hits: 100, crits: 20, total: 4000, critTotal: 2000 }));
  assert.equal(crit, 100); // 2000 / 20
  assert.equal(normal, 25); // 2000 / 80
  assert.equal(multiple, 4);
});

test("critAverages invents nothing when a side is empty", () => {
  // No crits means no average crit. Reporting 0 would draw a multiplier below 1 and read as
  // though critting were a penalty.
  const none = critAverages(cat({ hits: 50, crits: 0, total: 500, critTotal: 0 }));
  assert.equal(none.crit, null);
  assert.equal(none.multiple, null);
  const all = critAverages(cat({ hits: 3, crits: 3, total: 300, critTotal: 300 }));
  assert.equal(all.normal, null);
  assert.equal(all.multiple, null);
});

test("isThinSample marks a rate resting on a handful of rolls", () => {
  assert.equal(isThinSample(cat({ hits: 12 })), true);
  assert.equal(isThinSample(cat({ hits: THIN_SAMPLE })), false);
  assert.equal(isThinSample(cat({ hits: 0 })), false, "empty is not thin, it is absent");
  assert.equal(isThinSample(cat({ hits: 5, crittable: false })), false, "a definite non-answer");
});

test("shownAbilities keeps a well-used ability that has never critted", () => {
  const ability = (name: string, hits: number, crits: number): CritAbility => ({
    name, category: "spell", hits, crits, total: hits * 10, critTotal: crits * 30, best: null,
  });
  const rows = shownAbilities(
    cat({ abilities: [ability("Flame Bolt", 599, 0), ability("Ignite", 216, 2), ability("Odd Proc", 2, 0)] }),
  );
  // 599 casts and no crit is a finding; two casts and no crit is not yet anything.
  assert.deepEqual(rows.map((r) => r.name), ["Flame Bolt", "Ignite"]);
});

test("isThinCrits marks the figures that divide by crits, not hits", () => {
  // The case from a real log: 15,581 spell casts is a solid denominator for the rate, and the
  // five crits behind the average are not a solid denominator for anything.
  assert.equal(isThinCrits(cat({ hits: 15581, crits: 5 })), true);
  assert.equal(isThinSample(cat({ hits: 15581, crits: 5 })), false, "the rate itself is fine");
  assert.equal(isThinCrits(cat({ hits: 42838, crits: THIN_CRITS })), false);
  assert.equal(isThinCrits(cat({ hits: 39636, crits: 0 })), false, "no crits is not a thin average");
});
