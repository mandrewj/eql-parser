import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "./engine.js";
import { parseLine } from "../parser/parser.js";

// Helper: build a chronological event stream from raw log lines.
function feed(lines: string[], selfName = "Sanluen", timeoutSec = 20) {
  const engine = new Engine({ selfName, inactivityTimeoutSec: timeoutSec });
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev) engine.handle(ev);
  }
  engine.endInput();
  return engine;
}

const L = (t: string, body: string) => `[Sat Jul 18 ${t} 2026] ${body}`;

test("single fight: self + group DPS, self classified, mob is NPC", () => {
  const engine = feed([
    L("01:00:00", "You strike orc for 100 points of damage."),
    L("01:00:01", "Feydie kicks orc for 50 points of damage."),
    L("01:00:02", "Orc hits Feydie for 10 points of damage."),
    L("01:00:03", "You crush orc for 100 points of damage. (Critical)"),
    L("01:00:04", "You have slain orc!"),
  ]);
  const fights = engine.fights();
  assert.equal(fights.length, 1);
  const f = fights[0]!;
  assert.equal(f.title.toLowerCase(), "orc");

  const self = f.combatants.find((c) => c.isSelf)!;
  assert.equal(self.kind, "self");
  assert.equal(self.damage.total, 200); // 100 + 100 (crit)
  assert.equal(self.damage.crits, 1);

  const feydie = f.combatants.find((c) => c.name === "Feydie")!;
  assert.equal(feydie.kind, "player");
  assert.equal(feydie.damage.total, 50);

  // The orc is an NPC and does not appear among friendly damage dealers.
  const orc = f.combatants.find((c) => c.name.toLowerCase() === "orc")!;
  assert.equal(orc.kind, "npc");
  assert.equal(orc.damage.total, 10); // its outgoing damage is tracked separately
});

test("case-insensitive entity keys merge sentence-start capitalization", () => {
  const engine = feed([
    L("01:00:00", "You slash orc legionnaire for 40 points of damage."),
    L("01:00:01", "Orc legionnaire hits You for 5 points of damage."), // capitalized, same mob
    L("01:00:02", "You have slain orc legionnaire!"),
  ]);
  const f = engine.fights()[0]!;
  const npcs = f.combatants.filter((c) => c.kind === "npc");
  assert.equal(npcs.length, 1, "the mob should be a single merged NPC row");
});

test("two fights split by inactivity timeout", () => {
  const engine = feed(
    [
      L("01:00:00", "You strike rat for 10 points of damage."),
      L("01:00:01", "You have slain rat!"),
      // > 20s gap
      L("01:01:00", "You strike bat for 10 points of damage."),
      L("01:01:01", "You have slain bat!"),
    ],
    "Sanluen",
    20,
  );
  assert.equal(engine.fights().length, 2);
});

test("damage-type split and per-ability drill-down", () => {
  const engine = feed([
    L("01:00:00", "You pierce orc for 30 points of damage."),
    L("01:00:01", "Orc is burned by YOUR flames for 20 points of non-melee damage."),
    L("01:00:02", "Orc has taken 15 damage from your Chords of Dissonance III."),
    L("01:00:03", "You have slain orc!"),
  ]);
  const self = engine.fights()[0]!.combatants.find((c) => c.isSelf)!;
  assert.equal(self.damage.byType.melee, 30);
  assert.equal(self.damage.byType.spell, 20);
  assert.equal(self.damage.byType.dot, 15);
  assert.equal(self.damage.total, 65);
  const dot = self.damage.entries.find((a) => a.name === "Chords of Dissonance III")!;
  assert.equal(dot.damageType, "dot");
  assert.equal(dot.total, 15);
});

test("damage correlates with both stance dimensions (melee + invocation) at once", () => {
  const engine = feed([
    L("01:00:00", "You assume an offensive stance."),
    L("01:00:00", "You begin reciting the spellblade invocation."),
    L("01:00:01", "You strike orc for 100 points of damage."),
    L("01:00:05", "You assume a defensive stance."),
    L("01:00:06", "You strike orc for 40 points of damage."),
    L("01:00:07", "You have slain orc!"),
  ]);
  const self = engine.fights()[0]!.combatants.find((c) => c.isSelf)!;
  const melee = Object.fromEntries(self.stances!.melee.map((s) => [s.stance, s.total]));
  assert.equal(melee["offensive"], 100);
  assert.equal(melee["defensive"], 40);
  const inv = Object.fromEntries(self.stances!.invocation.map((s) => [s.stance, s.total]));
  assert.equal(inv["spellblade"], 140); // both hits under the one invocation
});

test("miss events count toward accuracy without adding damage", () => {
  const engine = feed([
    L("01:00:00", "You try to crush orc, but miss!"),
    L("01:00:01", "You crush orc for 20 points of damage."),
    L("01:00:02", "You have slain orc!"),
  ]);
  const self = engine.fights()[0]!.combatants.find((c) => c.isSelf)!;
  assert.equal(self.damage.avoided, 1); // one swing missed
  assert.equal(self.damage.hits, 1);
  assert.equal(self.damage.total, 20);
});

test("healing done is tracked per healer, with spell breakdown", () => {
  const engine = feed([
    L("01:00:00", "You strike orc for 30 points of damage."), // opens fight, marks orc NPC
    L("01:00:01", "Frogorson healed you for 40 hit points."),
    L("01:00:02", "Frogorson healed Feydie for 10 hit points by Light."),
    L("01:00:03", "You have slain orc!"),
  ]);
  const f = engine.fights()[0]!;
  const frog = f.combatants.find((c) => c.name === "Frogorson")!;
  assert.equal(frog.kind, "player"); // healed a friendly ⇒ friendly
  assert.equal(frog.healing.total, 50);
  assert.equal(frog.damage.total, 0);
  const light = frog.healing.entries.find((e) => e.name === "Light")!;
  assert.equal(light.total, 10);
});

test("self's pet folds into the owner with a paw-tagged breakdown", () => {
  const engine = feed([
    L("01:00:00", "Gore says, 'Attacking an orc Master.'"), // Gore is my pet
    L("01:00:01", "You crush an orc for 50 points of damage."),
    L("01:00:02", "Gore bites an orc for 30 points of damage."),
    L("01:00:03", "You have slain an orc!"),
  ]);
  const f = engine.fights()[0]!;
  // The pet is not a separate row — its damage is attributed to Sanluen.
  assert.equal(f.combatants.some((c) => c.name === "Gore"), false);
  const self = f.combatants.find((c) => c.isSelf)!;
  assert.equal(self.damage.total, 80); // 50 own + 30 pet
  const petEntry = self.damage.entries.find((e) => e.name.includes("bite"))!;
  assert.ok(petEntry, "owner drill-down includes the pet's ability");
  assert.ok(petEntry.name.startsWith("🐾"), "pet ability is paw-tagged");
});

function at(t: string): number {
  return Date.parse(`Sat Jul 18 ${t} 2026`);
}
function feedInto(engine: Engine, lines: string[]): void {
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev) engine.handle(ev);
  }
}

test("enemy pet encounter goes inactive when its owner is slain", () => {
  let clock = at("01:00:10");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You crush an orc thaumaturgist for 50 points of damage."),
    L("01:00:00", "You crush an orc thaumaturgist pet for 20 points of damage."),
    L("01:00:05", "You have slain an orc thaumaturgist!"), // owner dies; pet despawns
  ]);
  const active = engine.snapshot().activeEncounters.map((e) => e.name.toLowerCase());
  assert.equal(active.includes("an orc thaumaturgist"), false, "slain owner is not an active encounter");
  assert.equal(active.includes("an orc thaumaturgist pet"), false, "pet is inactive once its owner is dead");
});

test("a same-named respawn shows as active (not hidden by the earlier death)", () => {
  let clock = at("01:00:12");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You crush a rat for 30 points of damage."), // rat #1
    L("01:00:01", "You crush a bat for 30 points of damage."), // bat keeps the fight open
    L("01:00:02", "You have slain a rat!"), // rat #1 dies; fight stays open via the bat
    L("01:00:08", "You crush a rat for 30 points of damage."), // rat #2 respawn, same key
  ]);
  const active = engine.snapshot().activeEncounters.map((e) => e.name.toLowerCase());
  assert.ok(active.includes("a rat"), "the respawned rat is an active encounter");
  assert.ok(active.includes("a bat"), "the bat is still active");
});

test("an encounter goes inactive after 90s of no activity on that NPC", () => {
  let clock = at("01:00:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You crush orc A for 10 points of damage."),
    L("01:00:00", "You crush orc B for 10 points of damage."),
    L("01:00:05", "You crush orc A for 10 points of damage."), // A stays fresh
  ]);
  clock = at("01:01:32"); // 92s after start: A idle 87s, B idle 92s
  const active = engine.snapshot().activeEncounters.map((e) => e.name.toLowerCase());
  assert.equal(active.includes("orc a"), true, "A active (87s idle ≤ 90)");
  assert.equal(active.includes("orc b"), false, "B stale (92s idle > 90)");
});

test("same-named mobs are separate encounters with correct durations (no merge)", () => {
  const engine = feed([
    L("01:00:00", "You crush a clay gargoyle for 100 points of damage."),
    L("01:00:10", "You have slain a clay gargoyle!"), // first instance: ~10s
    L("01:00:40", "You crush a clay gargoyle for 100 points of damage."), // fresh respawn
    L("01:00:50", "You have slain a clay gargoyle!"), // second instance: ~10s
  ]);
  const recent = engine.snapshot().recentEncounters;
  assert.equal(recent.length, 2, "two separate gargoyle encounters, not one merged");
  assert.equal(recent[0]!.durationSec, 10, "second kill is ~10s, not the 50s span");
  assert.equal(recent[1]!.durationSec, 10, "first kill is ~10s");
});

test("recent encounters: one per kill, newest first, oldest drops past 5", () => {
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90 });
  for (let i = 1; i <= 7; i++) {
    feedInto(engine, [
      L("01:00:00", `You crush mob${i} for 10 points of damage.`),
      L("01:00:01", `Feydie kicks mob${i} for 40 points of damage.`),
      L("01:00:02", `You have slain mob${i}!`),
    ]);
  }
  const recent = engine.snapshot().recentEncounters;
  assert.equal(recent.length, 5, "only the last 5 encounters are kept");
  assert.equal(recent[0]!.name, "mob7", "newest encounter is first");
  assert.equal(recent[4]!.name, "mob3", "oldest kept is mob3 (mob1/mob2 dropped)");
  // Cards ranked by DPS in that encounter (Feydie 40 > Sanluen 10), self present.
  assert.deepEqual(recent[0]!.cards.map((c) => c.name), ["Feydie", "Sanluen"]);
});

test("per-person DPS uses each character's own active window (late joiner)", () => {
  const engine = feed([
    L("01:00:00", "You crush an orc for 100 points of damage."), // self engages at t0
    L("01:00:10", "Feydie kicks an orc for 100 points of damage."), // Feydie joins 10s in
    L("01:00:10", "You have slain an orc!"), // kill at t+10s
  ]);
  const enc = engine.snapshot().recentEncounters[0]!;
  const self = enc.cards.find((c) => c.isSelf)!;
  const feydie = enc.cards.find((c) => c.name === "Feydie")!;
  assert.equal(self.damage.perSec, 10); // 100 over 10s
  assert.equal(feydie.damage.perSec, 100); // 100 over ~1s (joined at the very end)
  assert.equal(enc.cards.map((c) => c.name)[0], "Feydie", "ranked by DPS: Feydie (100) first");
});

test("cards report the engaged window their rates divide by", () => {
  const engine = feed([
    L("01:00:00", "You crush an orc for 100 points of damage."),
    L("01:00:06", "an orc hits Ranshi for 20 points of damage."), // Ranshi's first contact is being hit
    L("01:00:08", "Feydie kicks an orc for 40 points of damage."),
    L("01:00:10", "Ranshi slashes an orc for 60 points of damage."),
    L("01:00:10", "You have slain an orc!"),
  ]);
  const enc = engine.snapshot().recentEncounters[0]!;
  assert.equal(enc.durationSec, 10);
  const by = Object.fromEntries(enc.cards.map((c) => [c.name, c]));
  assert.equal(by.Sanluen!.activeSec, 10, "there from the start");
  assert.equal(by.Feydie!.activeSec, 2, "joined 8s in");
  assert.equal(by.Ranshi!.activeSec, 4, "engaged when the mob hit them, not when they swung back");
  // The window is exactly what each rate divides by, so dps × activeSec is their damage.
  for (const c of enc.cards) assert.equal(Math.round(c.damage.perSec * c.activeSec), c.damage.total);
});

test("recent-encounter cards carry windowed healing + taken-from-mob", () => {
  const engine = feed([
    L("01:00:00", "You crush an orc for 60 points of damage."),
    L("01:00:01", "Orson healed you for 25 hit points by Healing."), // within the window
    L("01:00:01", "an orc hits You for 15 points of damage."),
    L("01:00:02", "You have slain an orc!"),
  ]);
  const enc = engine.snapshot().recentEncounters[0]!;
  const self = enc.cards.find((c) => c.isSelf)!;
  assert.equal(self.damage.total, 60);
  assert.equal(self.taken.total, 15, "damage taken from this mob");
  const orson = enc.cards.find((c) => c.name === "Orson");
  // Orson didn't damage the orc, so isn't a card here; healing shows on healers who also dealt dmg.
  assert.equal(orson, undefined);
  // Self healed 0 (Orson healed self); confirm the healing field exists and is a number.
  assert.equal(self.healing.total, 0);
});

test("encounter header: whole-encounter totals and the mob's own output", () => {
  const engine = feed([
    L("01:00:00", "You crush an orc for 60 points of damage."),
    L("01:00:04", "an orc hits You for 15 points of damage."),
    L("01:00:06", "Feydie kicks an orc for 40 points of damage."), // joins late
    L("01:00:08", "an orc hits Feydie for 25 points of damage."),
    L("01:00:10", "You have slain an orc!"),
  ]);
  const enc = engine.snapshot().recentEncounters[0]!;
  assert.equal(enc.durationSec, 10);
  assert.equal(enc.total, 100, "everyone's damage to the mob, not just the top row");
  assert.equal(enc.dps, 10, "100 over the full 10s span, not a per-person window");
  // Feydie's own rate is windowed to her contact onward — the header figure is not.
  assert.equal(enc.cards.find((c) => c.name === "Feydie")!.damage.perSec, 10); // 40 over 4s
  assert.equal(enc.npcDamage.total, 40, "what the orc dealt to everyone (15 + 25)");
  assert.equal(enc.npcDamage.perSec, 4);
});

test("a same-named respawn's output starts from zero", () => {
  const engine = feed([
    L("01:00:00", "You crush a rat for 30 points of damage."),
    L("01:00:02", "a rat hits You for 20 points of damage."),
    L("01:00:04", "You have slain a rat!"),
    L("01:00:06", "You crush a rat for 30 points of damage."), // a fresh rat
    L("01:00:08", "a rat hits You for 5 points of damage."),
    L("01:00:10", "You have slain a rat!"),
  ]);
  const [newest, older] = engine.snapshot().recentEncounters;
  assert.equal(older!.npcDamage.total, 20);
  assert.equal(newest!.npcDamage.total, 5, "the second rat's output excludes the first's");
});

test("healer's own healing surfaces on their encounter card (windowed)", () => {
  const engine = feed([
    L("01:00:00", "Orson crushes an orc for 20 points of damage."), // Orson also deals dmg
    L("01:00:00", "You crush an orc for 60 points of damage."),
    L("01:00:01", "Orson healed you for 25 hit points by Healing."),
    L("01:00:02", "You have slain an orc!"),
  ]);
  const orson = engine.snapshot().recentEncounters[0]!.cards.find((c) => c.name === "Orson")!;
  assert.equal(orson.damage.total, 20);
  assert.equal(orson.healing.total, 25, "Orson's heal in the encounter window");
});

test("fleeing (zoning) still finalizes the un-slain boss into the recent list", () => {
  const engine = feed([
    L("01:00:00", "You crush a dragon for 500 points of damage."),
    L("01:00:01", "a dragon hits You for 80 points of damage."),
    L("01:00:05", "You have entered The Greater Faydark."), // fled, dragon never died
  ]);
  const recent = engine.snapshot().recentEncounters;
  assert.equal(recent[0]!.name, "a dragon", "the boss you fled is in the recent list");
  const self = recent[0]!.cards.find((c) => c.isSelf)!;
  assert.equal(self.damage.total, 500);
  assert.equal(self.taken.total, 80);
});

test("stance overview: self DPS split by stance+invocation combination", () => {
  let clock = at("01:02:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You assume an offensive stance."),
    L("01:00:00", "You begin reciting the spellblade invocation."),
    L("01:00:02", "You crush an orc for 100 points of damage."),
    L("01:00:08", "You crush an orc for 100 points of damage."),
    L("01:00:10", "You have slain an orc!"),
    L("01:00:12", "You assume a defensive stance."), // invocation unchanged
    L("01:00:14", "You crush a bat for 20 points of damage."),
    L("01:00:24", "You crush a bat for 20 points of damage."),
    L("01:00:26", "You have slain a bat!"),
  ]);
  const windows = engine.snapshot().stanceOverview;
  assert.deepEqual(windows.map((w) => w.n), [10, 25, 50]);
  const ov = windows.find((w) => w.n === 10)!.rows;
  const off = ov.find((r) => r.melee === "offensive" && r.invocation === "spellblade")!;
  const def = ov.find((r) => r.melee === "defensive" && r.invocation === "spellblade")!;
  assert.equal(off.damage, 200);
  assert.equal(def.damage, 40);
  assert.ok(off.dps > def.dps, "offensive+spellblade out-DPSes defensive+spellblade");
  assert.equal(off.timeShare + def.timeShare, 100, "time shares cover the window");
});

test("history points are normalized by encounter length, not by my window in it", () => {
  const engine = feed([
    // A 20s fight someone else opened; I land one 900-damage hit in its last 2 seconds.
    L("01:00:00", "Feydie kicks an orc for 100 points of damage."),
    L("01:00:18", "You crush an orc for 900 points of damage."),
    L("01:00:20", "You have slain an orc!"),
  ]);
  const p = engine.snapshot().encounterHistory[0]!;
  assert.equal(p.durationSec, 20);
  assert.equal(p.damage, 900);
  assert.equal(p.dps, 45, "900 over the encounter's 20s — not 450 over my 2s window");
  // The encounter table still reports my per-person rate; the two answer different questions.
  const card = engine.snapshot().recentEncounters[0]!.cards.find((c) => c.isSelf)!;
  assert.equal(card.damage.perSec, 450);
});

test("window average is duration-weighted, not a mean of per-encounter rates", () => {
  // 100 damage in 2s (50 dps), then 900 damage in 30s (30 dps). The 90s timeout keeps the
  // 58s lull from closing the fight, which would cap the bear at its last activity instead.
  const engine = feed(
    [
      L("01:00:00", "You crush a rat for 100 points of damage."),
      L("01:00:02", "You have slain a rat!"),
      L("01:01:00", "You crush a bear for 900 points of damage."),
      L("01:01:30", "You have slain a bear!"),
    ],
    "Sanluen",
    90,
  );
  const pts = engine.snapshot().encounterHistory;
  assert.deepEqual(pts.map((p) => p.dps).sort((a, b) => a - b), [30, 50]);
  const dmg = pts.reduce((s, p) => s + p.damage, 0);
  const sec = pts.reduce((s, p) => s + p.durationSec, 0);
  // What the chart's average line draws: 1000 / 32s = 31, right next to the long fight it
  // spent its seconds in. (A mean of the two rates would say 40 — the 2-second rat counting
  // for as much as a mob fifteen times its length. The chart's own weighting lives in
  // `EncounterHistory`, which has no runner here; this pins the points it weighs.)
  assert.equal(dmg, 1000);
  assert.equal(sec, 32);
  assert.equal(Math.round(dmg / sec), 31);
});

test("stance overview: the window's headline rate keeps zero-damage combo seconds", () => {
  let clock = at("01:02:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You assume an offensive stance."),
    L("01:00:02", "You crush an orc for 400 points of damage."),
    L("01:00:10", "You assume a defensive stance."), // 10s of combat, no damage dealt
    L("01:00:20", "You have slain an orc!"),
  ]);
  const w = engine.snapshot().stanceOverview.find((x) => x.n === 10)!;
  assert.equal(w.rows.length, 1, "the silent defensive combo earns no tile");
  assert.equal(w.damage, 400);
  // The window is the encounter's span (my first hit at :02 → the kill at :20): 8s offensive
  // then 10s defensive. Both count, so the headline rate is 400/18, not 400/8.
  assert.equal(w.seconds, 18, "the silent combo's seconds still count against the window rate");
  assert.equal(Math.round(w.damage / w.seconds), 22);
  assert.equal(w.rows[0]!.dps, 50, "the tile's own rate covers only its own 8 seconds");
  assert.equal(w.rows[0]!.timeShare, 44, "shares fall short of 100% by the silent combo's time");
});

test("stance overview: damage taken and time share are split by combo too", () => {
  let clock = at("01:02:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You assume an offensive stance."),
    L("01:00:00", "You begin reciting the spellblade invocation."),
    L("01:00:02", "You crush an orc for 100 points of damage."),
    L("01:00:04", "an orc hits You for 60 points of damage."), // taken while offensive
    L("01:00:10", "You have slain an orc!"),
    L("01:00:12", "You assume a defensive stance."),
    L("01:00:14", "You crush a bat for 20 points of damage."),
    L("01:00:16", "a bat hits You for 5 points of damage."), // taken while defensive
    L("01:00:26", "You have slain a bat!"),
  ]);
  const rows = engine.snapshot().stanceOverview.find((w) => w.n === 10)!.rows;
  const off = rows.find((r) => r.melee === "offensive")!;
  const def = rows.find((r) => r.melee === "defensive")!;
  assert.equal(off.taken, 60, "damage taken is attributed to the combo active at the time");
  assert.equal(def.taken, 5);
  assert.ok(off.takenPerSec > def.takenPerSec, "the offensive combo costs more incoming damage");
  assert.ok(off.takenPerSec > 0, "a meaningful rate is populated");
  // Rates are whole numbers like DPS, so a trickle rounds to 0/sec — the total still
  // records it, and the card renders "<1" rather than a bare 0.
  assert.equal(def.takenPerSec, 0);
  assert.ok(def.taken > 0);
});

test("stance overview: my own damage is never counted as damage taken", () => {
  let clock = at("01:02:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You assume an offensive stance."),
    L("01:00:02", "You crush an orc for 100 points of damage."),
    L("01:00:10", "You have slain an orc!"),
  ]);
  const rows = engine.snapshot().stanceOverview.find((w) => w.n === 10)!.rows;
  assert.equal(rows[0]!.taken, 0, "outgoing damage stays out of the taken column");
});

test("zoning ends the current fight and all its encounters", () => {
  const engine = feed([
    L("01:00:00", "You crush an orc for 40 points of damage."),
    L("01:00:01", "You crush a bat for 10 points of damage."),
    L("01:00:03", "You have entered The Greater Faydark."), // zone — ends combat
    L("01:00:20", "You crush a rat for 15 points of damage."), // new zone, new fight
  ]);
  const fights = engine.fights();
  assert.equal(fights.length, 2, "zoning split the session into two fights");
  assert.ok(fights[0]!.npcs.some((n) => n.toLowerCase().includes("orc")), "pre-zone fight has the orc");
  assert.ok(fights[1]!.npcs.some((n) => n.toLowerCase().includes("rat")), "post-zone fight has the rat");
});

test("tick() closes an abandoned fight after the inactivity window", () => {
  let clock = at("01:00:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [L("01:00:00", "You crush orc for 10 points of damage.")]);
  assert.equal(engine.hasCurrent, true);
  clock = at("01:00:30");
  assert.equal(engine.tick(), false); // 30s < 90 → stays open
  assert.equal(engine.hasCurrent, true);
  clock = at("01:02:00");
  assert.equal(engine.tick(), true); // 120s > 90 → closed
  assert.equal(engine.hasCurrent, false);
});

// --- progression milestones -----------------------------------------------

test("milestones: levels, ability points, AAs, deaths and zones land on the timeline", () => {
  let clock = at("01:02:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You crush an orc for 100 points of damage."),
    L("01:00:04", "You have slain an orc!"),
    L("01:00:05", "You have gained a level! Welcome to level 34!"),
    L("01:00:06", "You have gained 2 ability point(s)!  You now have 4 ability point(s)."),
    L("01:00:07", 'You have gained the ability "Banestrike" at a cost of 0 ability points.'),
    L("01:00:20", "a bat hits You for 5 points of damage."),
    L("01:00:22", "You have been slain by a bat!"),
    L("01:00:30", "You have entered The Greater Faydark."),
  ]);
  const snap = engine.snapshot();
  assert.deepEqual(
    snap.milestones.map((m) => m.kind),
    ["level", "ap", "ability", "death", "zone"],
    "chronological, one per event",
  );
  assert.equal(snap.progress.level, 34);
  assert.equal(snap.progress.abilityPoints, 4, "unspent AP is the 'you now have' figure");
  assert.equal(snap.milestones.find((m) => m.kind === "death")!.detail, "Slain by a bat");
  assert.equal(snap.milestones.find((m) => m.kind === "ability")!.label, "Banestrike");
});

test("a friendly death does not erase that character's damage from the live fight", () => {
  let clock = at("01:00:20");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You crush an orc for 100 points of damage."),
    L("01:00:01", "Feydie kicks an orc for 60 points of damage."),
    L("01:00:02", "Feydie has been slain by an orc!"),
    L("01:00:03", "You have been slain by an orc!"),
  ]);
  const enc = engine.snapshot().activeEncounters.find((e) => e.name.toLowerCase().includes("orc"))!;
  assert.equal(enc.cards.find((c) => c.isSelf)!.damage.total, 100);
  assert.equal(enc.cards.find((c) => c.name === "Feydie")!.damage.total, 60);
});

test("milestones: an AA rank-up carries the rank in its label", () => {
  const engine = feed([L("01:00:01", "You have improved Lay on Hands 3 at a cost of 0 ability points.")]);
  assert.equal(engine.snapshot().milestones[0]!.label, "Lay on Hands 3");
});

test("progression never opens or extends a fight", () => {
  const engine = feed([
    L("01:00:00", "You crush an orc for 40 points of damage."),
    L("01:00:02", "You have slain an orc!"),
    // Long after the fight closed: these must not resurrect it or start a new one.
    L("01:05:00", "You have gained a level! Welcome to level 12!"),
    L("01:05:01", "You gain party experience! (8.995%)"),
  ]);
  assert.equal(engine.hasCurrent, false);
  assert.equal(engine.fights().length, 1);
  assert.equal(engine.snapshot().milestones.filter((m) => m.kind === "level").length, 1);
});

test("progress windows: skill-ups and xp are counted, not marked", () => {
  let clock = at("01:02:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You crush an orc for 100 points of damage."),
    L("01:00:01", "You have become better at Kick! (110)"),
    L("01:00:02", "You have become better at Kick! (111)"),
    L("01:00:03", "You gain party experience! (8.5%)"),
    L("01:00:04", "You gain experience! (1.5%)"),
    L("01:00:05", "You have slain an orc!"),
    L("01:00:06", "You have gained 2 ability point(s)!  You now have 2 ability point(s)."),
  ]);
  const snap = engine.snapshot();
  assert.equal(snap.milestones.some((m) => m.kind === ("skill" as never)), false, "skill-ups stay off the rail");
  const w = snap.progressWindows.find((p) => p.n === 10)!;
  assert.equal(w.skillUps, 2);
  assert.equal(w.xpPct, 10);
  assert.equal(w.apGained, 2, "AP gained after the last kill still counts in the window");
  assert.equal(w.levels, 0);
  assert.deepEqual(snap.progressWindows.map((p) => p.n), [10, 25, 50]);
});

test("progress windows are empty until an encounter exists to scope them", () => {
  const engine = feed([L("01:00:01", "You have become better at Kick! (110)")]);
  assert.deepEqual(
    engine.snapshot().progressWindows.map((w) => w.skillUps),
    [0, 0, 0],
  );
});

test("encounter history points carry the window the chart needs", () => {
  let clock = at("01:02:00");
  const engine = new Engine({ selfName: "Sanluen", inactivityTimeoutSec: 90, now: () => clock });
  feedInto(engine, [
    L("01:00:00", "You crush an orc for 100 points of damage."),
    L("01:00:10", "You have slain an orc!"),
  ]);
  const p = engine.snapshot().encounterHistory[0]!;
  assert.equal(p.startMs, at("01:00:00"));
  assert.equal(p.endMs, at("01:00:10"));
  assert.equal(p.durationSec, 10);
});

test("damage taken (tanking) aggregates incoming damage per target", () => {
  const engine = feed([
    L("01:00:00", "You strike orc for 30 points of damage."),
    L("01:00:01", "Orc hits You for 12 points of damage."),
    L("01:00:02", "Orc hits You for 8 points of damage."),
    L("01:00:03", "Orc tries to hit You, but misses!"),
    L("01:00:04", "You have slain orc!"),
  ]);
  const self = engine.fights()[0]!.combatants.find((c) => c.isSelf)!;
  assert.equal(self.taken.total, 20); // 12 + 8
  assert.equal(self.taken.byType.melee, 20);
  assert.equal(self.taken.avoided, 1); // dodged one swing
  const hit = self.taken.entries.find((e) => e.name === "hit")!;
  assert.equal(hit.total, 20);
});
