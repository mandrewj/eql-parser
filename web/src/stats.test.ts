import { test } from "node:test";
import assert from "node:assert/strict";
import { PARTIAL_WINDOW, isPartialWindow, weightedAvgDps } from "./stats.js";
import type { SelfEncounterPoint } from "./types.js";

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
