import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseLine, splitLine } from "./parser.js";
import { resolveLogDir, defaultLog } from "../config.js";

const TS = "[Sat Jul 18 01:49:02 2026] ";

test("timestamp split handles space-padded single-digit day + CRLF", () => {
  const s = splitLine("[Sat Jul  5 09:08:07 2026] You strike a rat for 3 points of damage.\r");
  assert.ok(s);
  assert.equal(s!.body, "You strike a rat for 3 points of damage.");
  assert.equal(Number.isNaN(s!.tsMs), false);
});

test("melee — you, no crit", () => {
  const e = parseLine(TS + "You strike orc legionnaire for 50 points of damage.");
  assert.deepEqual(
    { ...e, tsMs: 0, raw: "" },
    { type: "melee", tsMs: 0, raw: "", attacker: "You", target: "orc legionnaire", verb: "strike", amount: 50, crit: false },
  );
});

test("melee — you, critical", () => {
  const e = parseLine(TS + "You crush royal guard for 18 points of damage. (Critical)");
  assert.equal(e?.type, "melee");
  if (e?.type !== "melee") return;
  assert.equal(e.amount, 18);
  assert.equal(e.crit, true);
  assert.equal(e.modifier, "Critical");
});

test("melee — other attacker, multi-word name splits correctly", () => {
  const e = parseLine(TS + "Orc legionnaire hits Feydie for 1 point of damage.");
  assert.equal(e?.type, "melee");
  if (e?.type !== "melee") return;
  assert.equal(e.attacker, "Orc legionnaire");
  assert.equal(e.verb, "hit"); // third-person "hits" normalized to base "hit"
  assert.equal(e.target, "Feydie");
  assert.equal(e.amount, 1);
});

test("melee — other, crit", () => {
  const e = parseLine(TS + "Feydie kicks orc centurion for 23 points of damage. (Critical)");
  assert.equal(e?.type, "melee");
  if (e?.type !== "melee") return;
  assert.equal(e.attacker, "Feydie");
  assert.equal(e.crit, true);
});

test("spell (non-melee) — YOUR", () => {
  const e = parseLine(TS + "Orc taskmaster is burned by YOUR flames for 5 points of non-melee damage.");
  assert.equal(e?.type, "spell");
  if (e?.type !== "spell") return;
  assert.equal(e.owner, "You");
  assert.equal(e.target, "Orc taskmaster");
  assert.equal(e.effect, "flames");
  assert.equal(e.amount, 5);
});

test("spell (non-melee) — named owner, ends with '!' and target YOU", () => {
  const e = parseLine(TS + "YOU are burned by Marrowbane's flames for 6 points of non-melee damage!");
  assert.equal(e?.type, "spell");
  if (e?.type !== "spell") return;
  assert.equal(e.owner, "Marrowbane");
  assert.equal(e.target, "You");
  assert.equal(e.amount, 6);
});

test("spell (non-melee) — backtick name target", () => {
  const e = parseLine(TS + "Ambassador D`Vinn is burned by YOUR flames for 5 points of non-melee damage.");
  assert.equal(e?.type, "spell");
  if (e?.type !== "spell") return;
  assert.equal(e.target, "Ambassador D`Vinn");
  assert.equal(e.owner, "You");
});

test("dot — your spell", () => {
  const e = parseLine(TS + "Orc legionnaire has taken 9 damage from your Chords of Dissonance III.");
  assert.equal(e?.type, "dot");
  if (e?.type !== "dot") return;
  assert.equal(e.caster, "You");
  assert.equal(e.spell, "Chords of Dissonance III");
  assert.equal(e.amount, 9);
});

test("dot — crit flag appended after the terminator", () => {
  const e = parseLine(TS + "An elf skeleton has taken 33 damage from Stinging Swarm by Orson. (Critical)");
  assert.equal(e?.type, "dot");
  if (e?.type !== "dot") return;
  assert.equal(e.spell, "Stinging Swarm");
  assert.equal(e.caster, "Orson");
  assert.equal(e.amount, 33);
});

test("melee — reave and shoot verbs (base-normalized)", () => {
  const reave = parseLine(TS + "Futor reaves Baron Telyx for 28 points of damage. (Critical)");
  assert.equal(reave?.type === "melee" && reave.verb, "reave");
  const shoot = parseLine(TS + "Sanluen shoots a bat for 12 points of damage.");
  assert.equal(shoot?.type === "melee" && shoot.verb, "shoot");
});

test("heal — over-time with spell and trailing crit", () => {
  const e = parseLine(TS + "Orson healed you over time for 62 hit points by Sprouting Heal. (Critical)");
  assert.equal(e?.type, "heal");
  if (e?.type !== "heal") return;
  assert.equal(e.healer, "Orson");
  assert.equal(e.target, "You");
  assert.equal(e.amount, 62);
  assert.equal(e.spell, "Sprouting Heal");
});

test("dot — spell by caster", () => {
  const e = parseLine(TS + "Orc centurion has taken 15 damage from Tainted Breath by Frogorson.");
  assert.equal(e?.type, "dot");
  if (e?.type !== "dot") return;
  assert.equal(e.caster, "Frogorson");
  assert.equal(e.spell, "Tainted Breath");
  assert.equal(e.amount, 15);
});

test("heal — simple effective amount", () => {
  const e = parseLine(TS + "Frogorson healed you for 7 hit points.");
  assert.equal(e?.type, "heal");
  if (e?.type !== "heal") return;
  assert.equal(e.healer, "Frogorson");
  assert.equal(e.target, "You");
  assert.equal(e.amount, 7);
});

test("heal — reflexive target maps to healer", () => {
  const e = parseLine(TS + "Frogorson healed himself for 16 hit points.");
  assert.equal(e?.type, "heal");
  if (e?.type !== "heal") return;
  assert.equal(e.target, "Frogorson");
  assert.equal(e.amount, 16);
});

test("heal — effective (raw) with spell name", () => {
  const e = parseLine(TS + "Bloodgurgler pet healed orc legionnaire for 0 (20) hit points by Courage.");
  assert.equal(e?.type, "heal");
  if (e?.type !== "heal") return;
  assert.equal(e.healer, "Bloodgurgler pet");
  assert.equal(e.target, "orc legionnaire");
  assert.equal(e.amount, 0); // effective (all overheal)
  assert.equal(e.attempted, 20);
  assert.equal(e.spell, "Courage");
});

test("pet — self's pet identified via 'Master' message", () => {
  const e = parseLine(TS + "Gore says, 'Attacking a decaying skeleton Master.'");
  assert.equal(e?.type, "pet");
  if (e?.type !== "pet") return;
  assert.equal(e.pet, "Gore");
  assert.equal(e.owner, "You");
});

test("pet — NPC dialogue is not mistaken for a pet", () => {
  assert.equal(parseLine(TS + "Orc taskmaster says, 'Centurions!  Come join the fight!'"), null);
});

test("miss — you", () => {
  const e = parseLine(TS + "You try to crush orc legionnaire, but miss!");
  assert.equal(e?.type, "miss");
  if (e?.type !== "miss") return;
  assert.equal(e.attacker, "You");
  assert.equal(e.target, "orc legionnaire");
  assert.equal(e.verb, "crush");
  assert.equal(e.avoidance, "miss");
});

test("miss — other", () => {
  const e = parseLine(TS + "Orc legionnaire tries to cleave Feydie, but misses!");
  assert.equal(e?.type, "miss");
  if (e?.type !== "miss") return;
  assert.equal(e.attacker, "Orc legionnaire");
  assert.equal(e.target, "Feydie");
  assert.equal(e.avoidance, "misses");
});

test("death — you slay", () => {
  const e = parseLine(TS + "You have slain Emperor Crush!");
  assert.deepEqual({ ...e, tsMs: 0, raw: "" }, { type: "death", tsMs: 0, raw: "", victim: "Emperor Crush", killer: "You" });
});

test("death — slain by", () => {
  const e = parseLine(TS + "Orc centurion has been slain by Feydie!");
  assert.equal(e?.type, "death");
  if (e?.type !== "death") return;
  assert.equal(e.victim, "Orc centurion");
  assert.equal(e.killer, "Feydie");
});

// My own death says "have been", so the third-person "has been" pattern misses it.
test("death — my own", () => {
  const e = parseLine(TS + "You have been slain by a greater mummy!");
  assert.deepEqual(
    { ...e, tsMs: 0, raw: "" },
    { type: "death", tsMs: 0, raw: "", victim: "You", killer: "a greater mummy" },
  );
});

test("stance — assume", () => {
  for (const [line, stance] of [
    ["You assume an offensive stance.", "offensive"],
    ["You assume a striker stance.", "striker"],
    ["You assume an evasive stance.", "evasive"],
    ["You assume a balanced stance.", "balanced"],
  ] as const) {
    const e = parseLine(TS + line);
    assert.equal(e?.type, "stance");
    if (e?.type !== "stance") return;
    assert.equal(e.stance, stance);
  }
});

test("zone — 'You have entered' captures the zone", () => {
  const e = parseLine(TS + "You have entered The Greater Faydark.");
  assert.equal(e?.type, "zone");
  if (e?.type !== "zone") return;
  assert.equal(e.zone, "The Greater Faydark");
});

test("zone — the 'an area where' warning is not a zone", () => {
  assert.equal(parseLine(TS + "You have entered an area where levitation effects do not function."), null);
});

test("noise lines return null", () => {
  const noise = [
    "[Sat Jul 18 01:49:00 2026] Your wounds begin to heal.",
    "[Sat Jul 18 01:49:00 2026] Auto attack is on.",
    "[Sat Jul 18 01:49:43 2026] You are surrounded by flickering flames.", // no amount -> not damage
    "[Sat Jul 18 02:27:54 2026] Trukster tells General:2, 'even a stance'",
    "[Sat Jul 18 02:33:31 2026] Calis begins casting Burst of Flame.",
    "[Sat Jul 18 02:32:43 2026] You have reached the experience cap and will not gain any further experience.",
    // Someone quoting a progression message in chat is not my progression.
    "[Sat Jul 18 02:32:43 2026] Penlog tells NewPlayers1:1, 'You have become better at athletics (20).'",
  ];
  for (const line of noise) assert.equal(parseLine(line), null, line);
});

// --- progression (self only) ----------------------------------------------

/** Parse a body and drop the envelope fields, so cases read as just the payload. */
const prog = (body: string) => {
  const e = parseLine(TS + body);
  return e ? { ...e, tsMs: 0, raw: "" } : null;
};

test("progress — level up", () => {
  assert.deepEqual(prog("You have gained a level! Welcome to level 34!"), {
    type: "progress",
    tsMs: 0,
    raw: "",
    kind: "level",
    value: 34,
  });
});

test("progress — ability points (the game emits a double space mid-line)", () => {
  assert.deepEqual(prog("You have gained 2 ability point(s)!  You now have 4 ability point(s)."), {
    type: "progress",
    tsMs: 0,
    raw: "",
    kind: "ap",
    value: 2,
    total: 4,
  });
});

test("progress — AA bought, and AA ranked up (rank split off the name)", () => {
  assert.deepEqual(prog('You have gained the ability "Banestrike" at a cost of 0 ability points.'), {
    type: "progress",
    tsMs: 0,
    raw: "",
    kind: "ability",
    name: "Banestrike",
    value: 0,
    rank: 1,
  });
  assert.deepEqual(prog("You have improved Mnemonic Retention 2 at a cost of 1 ability point."), {
    type: "progress",
    tsMs: 0,
    raw: "",
    kind: "ability",
    name: "Mnemonic Retention",
    rank: 2,
    value: 1,
  });
  // A name carrying its own punctuation still splits at the trailing rank number.
  assert.deepEqual(prog("You have improved Symphonic Aura: Enabled 10 at a cost of 0 ability points."), {
    type: "progress",
    tsMs: 0,
    raw: "",
    kind: "ability",
    name: "Symphonic Aura: Enabled",
    rank: 10,
    value: 0,
  });
});

test("progress — a skill becoming usable is an unlock, not an AA purchase", () => {
  assert.deepEqual(prog("You have gained the ability to use Double Attack."), {
    type: "progress",
    tsMs: 0,
    raw: "",
    kind: "unlock",
    name: "Double Attack",
  });
});

test("progress — skill-ups and xp ticks (solo and party)", () => {
  assert.deepEqual(prog("You have become better at Flying Kick! (112)"), {
    type: "progress",
    tsMs: 0,
    raw: "",
    kind: "skill",
    name: "Flying Kick",
    value: 112,
  });
  for (const body of ["You gain party experience! (8.995%)", "You gain experience! (8.995%)"]) {
    assert.deepEqual(prog(body), { type: "progress", tsMs: 0, raw: "", kind: "xp", value: 8.995 }, body);
  }
});

// Coverage check against the real log (skipped when the log isn't present).
test("real log: every combat-relevant line parses", (t) => {
  const dir = resolveLogDir();
  const log = dir ? defaultLog(dir) : null;
  if (!log) {
    t.skip("no EverQuest Legends log found on this machine");
    return;
  }
  const text = fs.readFileSync(log.path, "utf8");
  const RELEVANT =
    /for \d+ points? of (?:non-melee )?damage|has taken \d+ damage from|have slain |has been slain by |, but miss(?:es)?!|You assume an? .+ stance\./;
  const unparsed: string[] = [];
  let parsed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const ev = parseLine(line);
    if (ev) parsed++;
    else if (RELEVANT.test(line)) unparsed.push(line);
  }
  assert.ok(parsed > 1000, `expected many parsed events, got ${parsed}`);
  assert.deepEqual(unparsed.slice(0, 10), [], `unparsed combat-relevant lines (showing first 10)`);
});
