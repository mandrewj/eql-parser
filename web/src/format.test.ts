import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDrill, fmtK, fmtTank, plural, scaleK, span } from "./format.js";

// Values here stay clear of thousands separators where a locale could differ; the
// separator itself is `toLocaleString`'s business, not ours.

test("scaleK switches to k-notation only at its threshold", () => {
  assert.equal(scaleK(999, 1000), "999");
  assert.equal(scaleK(1000, 1000), "1.0k");
  assert.equal(scaleK(1500, 1000), "1.5k");
  assert.equal(scaleK(0, 1000), "0");
});

test("scaleK drops the decimal past 100k, so narrow columns can't overflow", () => {
  assert.equal(scaleK(99_900, 1000), "99.9k");
  assert.equal(scaleK(100_000, 1000), "100k");
  assert.equal(scaleK(1_284_000, 1000), "1284k");
});

test("the per-column thresholds are the ones the layout was tuned for", () => {
  // dps/hps hold four characters comfortably; tanking totals climb fastest, so they
  // scale sooner; drill-down lines are the tightest of the three.
  assert.equal(fmtK(9999), "9,999");
  assert.equal(fmtK(10_000), "10.0k");
  assert.equal(fmtTank(1999), "1,999");
  assert.equal(fmtTank(2000), "2.0k");
  assert.equal(fmtDrill(999), "999");
  assert.equal(fmtDrill(1000), "1.0k");
});

test("span stays in seconds until a minute reads better", () => {
  assert.equal(span(45_000), "45s");
  assert.equal(span(89_000), "89s"); // a first session is seconds long, not "1m"
  assert.equal(span(90_000), "2m"); // 90s rounds to 2 minutes
  assert.equal(span(16 * 60_000), "16m");
  assert.equal(span(60 * 60_000), "1h 0m");
  assert.equal(span(95 * 60_000), "1h 35m");
});

test("plural only pluralizes when it should, and takes an irregular form", () => {
  assert.equal(plural(1, "level"), "1 level");
  assert.equal(plural(2, "level"), "2 levels");
  assert.equal(plural(0, "death"), "0 deaths");
  assert.equal(plural(1, "ability", "abilities"), "1 ability");
  assert.equal(plural(3, "ability", "abilities"), "3 abilities");
});
