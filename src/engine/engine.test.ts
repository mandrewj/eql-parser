import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "./engine.js";
import { parseLine } from "../parser/parser.js";
import type { CombatEvent } from "../types.js";

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
  const enc = Object.fromEntries(engine.fights()[0]!.encounters.map((e) => [e.name.toLowerCase(), e.active]));
  assert.equal(enc["an orc thaumaturgist"], false, "slain owner is inactive");
  assert.equal(enc["an orc thaumaturgist pet"], false, "pet is inactive once its owner is dead");
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
  const enc = Object.fromEntries(engine.fights()[0]!.encounters.map((e) => [e.name.toLowerCase(), e.active]));
  assert.equal(enc["orc a"], true, "A active (87s idle ≤ 90)");
  assert.equal(enc["orc b"], false, "B stale (92s idle > 90)");
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
