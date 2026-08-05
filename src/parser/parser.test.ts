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

test("pet — 'told you' is how this game delivers pet chatter", () => {
  for (const [line, pet] of [
    ["A fire giant warrior told you, 'Attacking a fire giant warrior Master.'", "A fire giant warrior"],
    ["Jonantik told you, 'Attacking a bandit lookout Master.'", "Jonantik"],
    // The comma form, where "Master" is an address rather than the sentence's tail.
    ["Kebekn told you, 'I am unable to wake an imp protector, Master.'", "Kebekn"],
  ] as const) {
    const e = parseLine(TS + line);
    assert.equal(e?.type, "pet", line);
    if (e?.type !== "pet") continue;
    assert.equal(e.pet, pet);
    assert.equal(e.owner, "You");
  }
});

test("pet — NPC dialogue is not mistaken for a pet", () => {
  assert.equal(parseLine(TS + "Orc taskmaster says, 'Centurions!  Come join the fight!'"), null);
  // "taskmaster" is not "Master" — the check is case-sensitive and word-bounded.
  assert.equal(parseLine(TS + "Sarys told you, 'the orc taskmaster hits hard'"), null);
});

test("miss — 'frenzy on' keeps its particle out of the target", () => {
  // `\w+` stopped at "frenzy" and the target became "on orc taskmaster" — an entity that
  // exists nowhere else in the log, but still reaches the friend/foe classifier.
  const e = parseLine(TS + "Chompy tries to frenzy on orc taskmaster, but misses!");
  assert.equal(e?.type, "miss");
  if (e?.type !== "miss") return;
  assert.equal(e.attacker, "Chompy");
  assert.equal(e.verb, "frenzy on");
  assert.equal(e.target, "orc taskmaster");

  const you = parseLine(TS + "You try to frenzy on a bandit lookout, but miss!");
  assert.equal(you?.type, "miss");
  if (you?.type !== "miss") return;
  assert.equal(you.target, "a bandit lookout");
  // The single-word verbs must not have grown an "on".
  const kick = parseLine(TS + "You try to kick orc legionnaire, but miss!");
  assert.equal(kick?.type === "miss" && kick.target, "orc legionnaire");
});

test("crits are read on every form that carries the flag", () => {
  const dot = parseLine(TS + "Orc centurion has taken 33 damage from Stinging Swarm by Orson. (Critical)");
  assert.equal(dot?.type === "dot" && dot.crit, true);

  const heal = parseLine(TS + "Orson healed you over time for 62 hit points by Sprouting Heal. (Critical)");
  assert.equal(heal?.type === "heal" && heal.crit, true);

  // …and stay false when the flag is something else, or absent.
  const riposte = parseLine(TS + "You slash a bandit for 15 points of damage. (Riposte)");
  assert.equal(riposte?.type === "melee" && riposte.crit, false);
  const plain = parseLine(TS + "Orc legionnaire has taken 9 damage from your Chords of Dissonance III.");
  assert.equal(plain?.type === "dot" && plain.crit, false);
  // "Riposte Critical" is still a crit.
  const both = parseLine(TS + "You slash a bandit for 15 points of damage. (Riposte Critical)");
  assert.equal(both?.type === "melee" && both.crit, true);
});

test("the three crits that never say 'Critical' are still crits", () => {
  // Each is emitted *instead of* (Critical), so reading only the literal word loses them —
  // 589 hits in a real log, 107 of them the self's own Crippling Blows.
  const kinds: Array<[string, string]> = [
    ["Crippling Blow", "crippling"],
    ["Slay Undead", "slay"],
    ["Finishing Blow", "finishing"],
    ["Critical", "critical"],
  ];
  for (const [flag, kind] of kinds) {
    const e = parseLine(TS + `You slash a ghoul for 64 points of damage. (${flag})`);
    assert.equal(e?.type === "melee" && e.crit, true, flag);
    assert.equal(e?.type === "melee" && e.critKind, kind, flag);
  }

  // Flags compose, and the crit word can sit anywhere inside the parenthetical.
  for (const flag of ["Riposte Strikethrough Critical", "Critical Double Bow Shot", "Riposte Crippling Blow"]) {
    const e = parseLine(TS + `You shoot an orc for 83 points of damage. (${flag})`);
    assert.equal(e?.type === "melee" && e.crit, true, flag);
  }

  // Resolution and extra-attack flags are not crits, and carry no kind at all.
  for (const flag of ["Riposte", "Strikethrough", "Flurry", "Rampage", "Double Bow Shot"]) {
    const e = parseLine(TS + `You kick an orc for 20 points of damage. (${flag})`);
    assert.equal(e?.type === "melee" && e.crit, false, flag);
    assert.equal(e?.type === "melee" && e.critKind, undefined, flag);
  }
});

test("spell damage says which line form it came from", () => {
  // The two forms are not interchangeable: only the named-ability one can carry a crit flag,
  // so the crit panel's spell denominator would be swamped by damage shields without this.
  const ability = parseLine(TS + "You hit orc taskmaster for 84 points of fire damage by Ignite. (Critical)");
  assert.equal(ability?.type === "spell" && ability.form, "ability");
  assert.equal(ability?.type === "spell" && ability.crit, true);
  assert.equal(ability?.type === "spell" && ability.critKind, "critical");

  const shield = parseLine(TS + "An orc pawn is pierced by YOUR thorns for 12 points of non-melee damage.");
  assert.equal(shield?.type === "spell" && shield.form, "nonmelee");
  assert.equal(shield?.type === "spell" && shield.crit, false);

  const unnamed = parseLine(TS + "You were hit by non-melee for 200 damage.");
  assert.equal(unnamed?.type === "spell" && unnamed.form, "nonmelee");
});

test("dot — a tick on me reads 'You have taken', not 'has taken'", () => {
  const e = parseLine(TS + "You have taken 50 damage from Burrowing Scarab by a death beetle.");
  assert.equal(e?.type, "dot");
  if (e?.type !== "dot") return;
  assert.equal(e.target, "You");
  assert.equal(e.caster, "a death beetle");
  assert.equal(e.spell, "Burrowing Scarab");
  assert.equal(e.amount, 50);
});

test("dot — 'damage by <Spell>' names no caster, so it resolves to Unknown", () => {
  const e = parseLine(TS + "A Tesch Mal Gnoll has taken 26 damage by Chords of Dissonance V.");
  assert.equal(e?.type, "dot");
  if (e?.type !== "dot") return;
  assert.equal(e.spell, "Chords of Dissonance V");
  assert.equal(e.caster, "Unknown", "the line simply does not say");
  assert.equal(e.amount, 26);
});

test("dot — widening to has/have and from/by leaves the named-caster form alone", () => {
  const e = parseLine(TS + "Orc centurion has taken 15 damage from Tainted Breath by Frogorson.");
  assert.equal(e?.type, "dot");
  if (e?.type !== "dot") return;
  assert.equal(e.spell, "Tainted Breath", "still splits at the last ' by '");
  assert.equal(e.caster, "Frogorson");
});

test("damage to me from an unnamed source", () => {
  const e = parseLine(TS + "You were hit by non-melee for 93 damage.");
  assert.equal(e?.type, "spell");
  if (e?.type !== "spell") return;
  assert.equal(e.target, "You");
  assert.equal(e.owner, "Unknown");
  assert.equal(e.amount, 93);
});

test("a fully absorbed damage shield is avoidance, not damage", () => {
  for (const [line, attacker, target] of [
    ["A yun ghoul wizard's magical skin absorbs the damage of YOUR thorns.", "You", "A yun ghoul wizard"],
    ["Princess Cherista's magical skin absorbs the damage of Orson's thorns.", "Orson", "Princess Cherista"],
  ] as const) {
    const e = parseLine(TS + line);
    assert.equal(e?.type, "miss", line);
    if (e?.type !== "miss") continue;
    assert.equal(e.attacker, attacker);
    assert.equal(e.target, target);
    assert.equal(e.verb, "thorns");
    assert.equal(e.avoidance, "absorbed");
  }
  // Its sibling arrives inside a "tries to …, but …!" line and is already a miss.
  const blow = parseLine(TS + "You try to kick Kahaptra Z`Taj, but Kahaptra Z`Taj's magical skin absorbs the blow!");
  assert.equal(blow?.type, "miss");
});

test("typed ability damage — the type adjective no longer hides the line", () => {
  const e = parseLine(TS + "You hit a bandit lookout for 4 points of fire damage by Burst of Flame.");
  assert.equal(e?.type, "spell");
  if (e?.type !== "spell") return;
  assert.equal(e.owner, "You");
  assert.equal(e.target, "a bandit lookout");
  assert.equal(e.amount, 4);
  assert.equal(e.effect, "Burst of Flame", "the line names the real ability");
  assert.equal(e.crit, false);
});

test("typed ability damage — every damage type, and a multi-word attacker", () => {
  for (const [line, owner, target, amount] of [
    ["Ranshi`s warder hit a dark sacrificer for 8 points of disease damage by Sicken.", "Ranshi`s warder", "a dark sacrificer", 8],
    ["an imp protector hit you for 51 points of fire damage by Dry Bone Fire Burst.", "an imp protector", "You", 51],
    ["a Rosch Mas Gnoll hit you for 172 points of magic damage by Lightning Bolt.", "a Rosch Mas Gnoll", "You", 172],
    ["Jonantik hit a bandit lookout for 6 points of cold damage by Water Elemental Attack.", "Jonantik", "a bandit lookout", 6],
    ["Mnxy hit a zol ghoul knight for 20 points of poison damage by Venom.", "Mnxy", "a zol ghoul knight", 20],
    ["Orson hit a ghoul for 9 points of unresistable damage by Wrath.", "Orson", "a ghoul", 9],
  ] as const) {
    const e = parseLine(TS + line);
    assert.equal(e?.type, "spell", line);
    if (e?.type !== "spell") continue;
    assert.equal(e.owner, owner);
    assert.equal(e.target, target);
    assert.equal(e.amount, amount);
  }
});

test("typed ability damage — the element is not a fixed list", () => {
  // It was magic/fire/cold/poison/disease/unresistable until a boss dealt *chromatic* damage
  // and four lines silently went unparsed. Any adjective in that slot is typed damage.
  const e = parseLine(TS + "Master Yael hit you for 640 points of chromatic damage by Mana Detonation.");
  assert.equal(e?.type, "spell");
  if (e?.type !== "spell") return;
  assert.equal(e.owner, "Master Yael");
  assert.equal(e.target, "You");
  assert.equal(e.amount, 640);
  assert.equal(e.effect, "Mana Detonation");
  // …and the two neighbouring forms must still not be swallowed by it.
  assert.equal(parseLine(TS + "You strike an orc for 50 points of damage.")?.type, "melee");
  assert.equal(
    parseLine(TS + "An orc is burned by YOUR flames for 5 points of non-melee damage.")?.type,
    "spell",
  );
});

test("typed ability damage — the trailing crit flag is read", () => {
  const e = parseLine(
    TS + "Futor hit a Teir`Dal priestess for 52 points of fire damage by Fingers of Fire. (Critical)",
  );
  assert.equal(e?.type, "spell");
  if (e?.type !== "spell") return;
  assert.equal(e.crit, true);
  assert.equal(e.effect, "Fingers of Fire");
});

test("typed ability damage — a plain melee swing is still melee", () => {
  const e = parseLine(TS + "You strike orc legionnaire for 50 points of damage.");
  assert.equal(e?.type, "melee", "no type adjective, so this stays a swing");
});

test("loot — only the 'kept it' form parses, and it names the corpse", () => {
  const e = parseLine(TS + "--You have looted a Mote of Minor Potential from a fire giant warrior's corpse.--");
  assert.equal(e?.type, "loot");
  if (e?.type !== "loot") return;
  assert.equal(e.item, "Mote of Minor Potential");
  assert.equal(e.from, "a fire giant warrior");
  // The other four loot forms mean sold or merged, not kept, and motes never use them.
  assert.equal(parseLine(TS + "You looted a Bone Chips from an orc's corpse and sold it for 7 copper."), null);
  assert.equal(
    parseLine(TS + "You looted a Throwing Boulder from a fire giant warrior's corpse to create a Throwing Boulder +6"),
    null,
  );
});

test("charm — both landing messages name the mob and no caster", () => {
  for (const [line, mob] of [
    ["a lava beetle's eyes glaze over.", "a lava beetle"],
    ["a greater dark bone has been charmed.", "a greater dark bone"],
    // A name ending in "s" still splits at the possessive, not inside itself.
    ["a greater ice bones's eyes glaze over.", "a greater ice bones"],
  ] as const) {
    const e = parseLine(TS + line);
    assert.equal(e?.type, "charm", line);
    if (e?.type !== "charm") continue;
    assert.equal(e.state, "on");
    assert.equal(e.who, mob);
    assert.equal(e.spell, undefined, "the landing line never names the spell or its caster");
  }
});

test("charm — a cast names the caster but no target, for the engine to pair up", () => {
  for (const [line, caster, spell] of [
    ["Phatez begins casting Charm III.", "Phatez", "Charm III"],
    ["Bloodgurgler begins casting Beguile IV.", "Bloodgurgler", "Beguile IV"],
    ["You begin singing Solon's Bewitching Bravura V.", "You", "Solon's Bewitching Bravura V"],
  ] as const) {
    const e = parseLine(TS + line);
    assert.equal(e?.type, "charm", line);
    if (e?.type !== "charm") continue;
    assert.equal(e.state, "cast");
    assert.equal(e.who, caster);
    assert.equal(e.spell, spell);
  }
});

test("charm — only charm-named spells count as a charm cast", () => {
  assert.equal(parseLine(TS + "You begin casting Greater Healing III."), null);
  assert.equal(parseLine(TS + "Orson begins casting Expulse Undead."), null);
});

test("charm — breaks, by wear-off and by the song ending", () => {
  const worn = parseLine(TS + "Your Solon's Bewitching Bravura spell has worn off of an imp protector.");
  assert.equal(worn?.type, "charm");
  if (worn?.type !== "charm") return;
  assert.equal(worn.state, "off");
  assert.equal(worn.who, "an imp protector");

  // The song ending names the song and no mob: it breaks every charm that song holds.
  const fizzle = parseLine(TS + "You miss a note, bringing your Solon's Bewitching Bravura to a close!");
  assert.equal(fizzle?.type, "charm");
  if (fizzle?.type !== "charm") return;
  assert.equal(fizzle.state, "off");
  assert.equal(fizzle.who, "");
  assert.equal(fizzle.spell, "Solon's Bewitching Bravura");
});

test("charm — a non-charm spell wearing off is not a charm break", () => {
  assert.equal(parseLine(TS + "Your Chords of Dissonance spell has worn off of a lava beetle."), null);
  assert.equal(parseLine(TS + "Your Selo's Accelerando spell has worn off of Futor."), null);
});

test("charm — chatter mentioning charm is not an event", () => {
  assert.equal(parseLine(TS + "Nottle tells General1:2, 'can enchanters not turn charmed pets taunt on?'"), null);
  // My own charm ending is about me, not about a pet of mine.
  assert.equal(parseLine(TS + "You are no longer charmed."), null);
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
