import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PARTIAL_WINDOW,
  THIN_SAMPLE,
  critAverages,
  critRate,
  critShare,
  THIN_CRITS,
  isPartialWindow,
  isThinCrits,
  isThinSample,
  shownAbilities,
  weightedAvgDps,
} from "./stats.js";
import type { CritAbility, CritCategoryStat, SelfEncounterPoint } from "./types.js";

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
