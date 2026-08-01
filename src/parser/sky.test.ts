import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchSkyItem, normalizeItemName, skyItemNames } from "./sky.js";
import { SKY_CLASSES } from "./sky-catalogue.js";
import { readInventory, inventoryPathFor, isUnexportedStorage } from "./inventory.js";
import { parseLogFileName } from "../config.js";
import { parseLine } from "./parser.js";

// --- the fold ----------------------------------------------------------------

test("normalise — upgrade suffixes name the same item and fold away", () => {
  const want = "brell's girdle";
  assert.equal(normalizeItemName("Brell's Girdle"), want);
  assert.equal(normalizeItemName("Brell's Girdle +4"), want);
  assert.equal(normalizeItemName("Brell's Girdle (Exaltation)"), want);
});

test("normalise — the game's backtick and the wiki's quote are the same apostrophe", () => {
  assert.equal(normalizeItemName("Spiroc Elder`s Totem"), normalizeItemName("Spiroc Elder's Totem"));
  assert.equal(normalizeItemName("Ervaj’s Flute of Flight"), normalizeItemName("Ervaj's Flute of Flight"));
});

test("normalise — case and inner whitespace do not distinguish items", () => {
  assert.equal(normalizeItemName("Crown Of Elemental Mastery"), normalizeItemName("crown of  elemental mastery"));
});

test("normalise — is idempotent, which is what lets the engine re-fold inventory keys", () => {
  const once = normalizeItemName("Tobrin's Mystical Eyepatch +3");
  assert.equal(normalizeItemName(once), once);
});

// --- matching ----------------------------------------------------------------

test("match — a game-spelled component resolves to the catalogue's spelling and role", () => {
  const m = matchSkyItem("spiroc elder`s totem");
  assert.equal(m?.name, "Spiroc Elder's Totem");
  assert.equal(m?.role, "component");
});

test("match — runes and rewards are tracked too, and are told apart", () => {
  assert.equal(matchSkyItem("Wind Rune Neza")?.role, "rune");
  assert.equal(matchSkyItem("Azure Ruby Ring")?.role, "reward");
});

test("match — an ordinary drop is not a Sky item", () => {
  assert.equal(matchSkyItem("Mote of Potential"), null);
  assert.equal(matchSkyItem("Water Flask"), null);
});

// --- catalogue integrity -----------------------------------------------------

test("catalogue — all 16 classes, each with quests, a giver and a reward", () => {
  assert.equal(SKY_CLASSES.length, 16);
  for (const c of SKY_CLASSES) {
    assert.ok(c.quests.length > 0, `${c.className} has no quests`);
    assert.ok(c.giver.length > 0, `${c.className} has no giver`);
    for (const q of c.quests) {
      assert.ok(q.rewards.length > 0, `${q.quest} has no reward`);
      assert.ok(q.rune.startsWith("Wind Rune "), `${q.quest} rune looks wrong: ${q.rune}`);
      assert.ok(q.trigger.length > 0, `${q.quest} has no trigger`);
    }
  }
});

/** The engine leans on this: one lookup answers "what is this", with no disambiguation. If the
 *  wiki ever names a reward the same as some other quest's component, this fails rather than
 *  letting one role silently shadow the other. */
test("catalogue — component, rune and reward names never collide once folded", () => {
  const seen = new Map<string, string>();
  for (const c of SKY_CLASSES) {
    for (const q of c.quests) {
      const rows: Array<[string, string]> = [
        [q.rune, "rune"],
        ...q.items.map((i): [string, string] => [i.name, "component"]),
        ...q.rewards.map((r): [string, string] => [r, "reward"]),
      ];
      for (const [name, role] of rows) {
        const key = normalizeItemName(name);
        const prev = seen.get(key);
        if (prev && prev !== role) assert.fail(`${name} is both ${prev} and ${role}`);
        seen.set(key, role);
      }
    }
  }
  assert.equal(skyItemNames().length, seen.size);
});

// --- inventory ---------------------------------------------------------------

function withFile(body: string, fn: (p: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eql-inv-"));
  const p = path.join(dir, "Test_freeport-Inventory.txt");
  fs.writeFileSync(p, body);
  try {
    fn(p);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The two files are tied together by character and server and nothing else, so the export
 *  follows whichever log is selected. Nothing here may be specific to the character this was
 *  written for. */
test("inventory — the export is derived from the selected log's character and server", () => {
  const cases: Array<[string, string]> = [
    ["eqlog_Sanluen_freeport.txt", "Sanluen_freeport-Inventory.txt"],
    ["eqlog_Sanluen_qeynos.txt", "Sanluen_qeynos-Inventory.txt"],
    ["eqlog_Someoneelse_antonius_bayle.txt", "Someoneelse_antonius_bayle-Inventory.txt"],
  ];
  for (const [log, want] of cases) {
    assert.equal(
      inventoryPathFor(`/games/EverQuest Legends/logs/${log}`),
      path.join("/games/EverQuest Legends", want),
      log,
    );
  }
});

test("inventory — a file that is not an eqlog names no export", () => {
  assert.equal(inventoryPathFor("/games/EverQuest Legends/logs/dbg.txt"), null);
});

/** The export path is built from `config.ts`'s reading of the log name rather than a second
 *  copy of that regex, so this pins the shared behaviour the pair depends on. */
test("inventory — identity is read from the name; the server may contain underscores", () => {
  assert.deepEqual(parseLogFileName("eqlog_Sanluen_antonius_bayle.txt"), {
    character: "Sanluen",
    server: "antonius_bayle",
  });
  assert.deepEqual(parseLogFileName("notalog.txt"), { character: null, server: null });
});

/** Falls back to the log's own folder, for someone who pointed EQL_LOG_DIR at a directory they
 *  copied both files into rather than the install's `logs/`. */
test("inventory — an export beside the log is found when the install layout has none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eql-side-"));
  try {
    const logPath = path.join(dir, "eqlog_Tester_erollisi.txt");
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(path.join(dir, "Tester_erollisi-Inventory.txt"), "Location\tName\tID\tCount\tSlots");
    assert.equal(inventoryPathFor(logPath), path.join(dir, "Tester_erollisi-Inventory.txt"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("inventory — Empty slots are placeholders, and stacks sum across slots", () => {
  const body = [
    "Location\tName\tID\tCount\tSlots",
    "General 1-Slot1\tMote of Potential\t148593\t28\t10",
    "General 2-Slot1\tMote of Potential\t148593\t4\t10",
    "Head-Slot2\tEmpty\t0\t0\t0",
  ].join("\r\n");
  withFile(body, (p) => {
    const inv = readInventory(p)!;
    assert.equal(inv.itemCount, 2);
    assert.equal(inv.counts.get("mote of potential"), 32);
    assert.equal(inv.counts.has("empty"), false);
  });
});

/** The keyring block has three columns and no count. A width check tuned to the main section
 *  drops all of it — and a finished quest's reward is exactly the sort of item that lives
 *  there, so this is the regression most worth pinning down. */
test("inventory — the trailing three-column keyring section is read, not dropped", () => {
  const body = [
    "Location\tName\tID\tCount\tSlots",
    "Chest\tImbrued Platemail Breastplate +2\t4862\t1\t10",
    "",
    "KeyRing\tName\tID\t",
    "Equipment\tWindstriker\t5412",
    "Equipment\tRazing Sword of Skarlon +7\t5412",
  ].join("\r\n");
  withFile(body, (p) => {
    const inv = readInventory(p)!;
    assert.equal(inv.itemCount, 3);
    // No Count column at all: one of the item, not zero.
    assert.equal(inv.counts.get("windstriker"), 1);
    assert.equal(inv.counts.get("razing sword of skarlon"), 1);
    assert.equal(matchSkyItem("Windstriker")?.role, "reward");
  });
});

test("inventory — a missing export is an empty baseline, not a throw", () => {
  assert.equal(readInventory("/no/such/inventory.txt"), null);
});

// --- the second loot form, and the export's blind spot ------------------------

/** Wind runes are routed to the currency tab, and that form of the line shares no punctuation
 *  with the `--You have looted--` one — no fence, no full stop. Without it every rune the
 *  character loots is invisible, which is exactly what happened. */
test("loot — an item routed to a storage is still looted", () => {
  const ev = parseLine(
    "[Sat Aug 01 13:20:57 2026] You looted a Wind Rune Azia from a thunder spirit's corpse and stored it in your currency",
  );
  assert.equal(ev?.type, "loot");
  if (ev?.type !== "loot") return;
  assert.equal(ev.item, "Wind Rune Azia");
  assert.equal(ev.from, "a thunder spirit");
  assert.equal(ev.storedIn, "currency");
  assert.equal(matchSkyItem(ev.item)?.role, "rune");
});

test("loot — the other two storages parse and name themselves", () => {
  for (const [line, dest] of [
    ["You looted a Darkbone Marrow from a dark boned skeleton's corpse and stored it in your tradeskill depot", "tradeskill depot"],
    ["You looted a Bronze Spear +2 from a rat's corpse and stored it in your Dragon Hoard", "Dragon Hoard"],
  ] as const) {
    const ev = parseLine(`[Sat Aug 01 12:14:58 2026] ${line}`);
    assert.equal(ev?.type, "loot", line);
    if (ev?.type === "loot") assert.equal(ev.storedIn, dest);
  }
});

/** The ~5,400 selling lines share the whole prefix up to the corpse, so only the storage
 *  clause tells them apart. Reading one as a pickup would credit items that were sold. */
test("loot — selling an item is not keeping it", () => {
  const ev = parseLine(
    "[Sat Aug 01 10:00:00 2026] You looted a Rusty Dagger from a rat's corpse and sold it for 7 copper.",
  );
  assert.equal(ev, null);
});

/** Which storages the export can vouch for was measured against a real export, not guessed.
 *  The currency tab and the Dragon Hoard have no section in the file; the tradeskill depot has
 *  one (`Personal-Depot`), so exempting it would double-count. */
test("storage — currency and the Dragon Hoard are outside the export's reach; the depot is not", () => {
  assert.equal(isUnexportedStorage("currency"), true);
  assert.equal(isUnexportedStorage("Currency"), true);
  assert.equal(isUnexportedStorage("Dragon Hoard"), true);
  assert.equal(isUnexportedStorage("dragon hoard"), true);
  assert.equal(isUnexportedStorage("tradeskill depot"), false);
  assert.equal(isUnexportedStorage(undefined), false); // an ordinary bag pickup
});

// --- the export-written cue ---------------------------------------------------

test("outputfile — the completion line is parsed and names the file", () => {
  const ev = parseLine("[Sat Aug 01 13:21:48 2026] Outputfile Complete: Sanluen_freeport-Inventory.txt");
  assert.equal(ev?.type, "outputfile");
  if (ev?.type === "outputfile") assert.equal(ev.file, "Sanluen_freeport-Inventory.txt");
});

/** Talking about the command must not be read as running it — a real log contains exactly
 *  this line. */
test("outputfile — merely mentioning the command is not a completion", () => {
  assert.equal(
    parseLine("[Sat Aug 01 12:34:31 2026] You say to your guild, 'the /outputfile inventory command is kinda cool'"),
    null,
  );
});

// --- the turn-in ---------------------------------------------------------------

/** Holding a reward says a quest is done; only this line says *when*. */
test("given — a reward handed over by an NPC is parsed", () => {
  const ev = parseLine("[Sat Aug 01 14:02:00 2026] You have been given: Espri");
  assert.equal(ev?.type, "given");
  if (ev?.type === "given") assert.equal(ev.item, "Espri");
  assert.equal(matchSkyItem("Espri")?.role, "reward");
});

/** A real log has three of these, and none is a Sky quest. The parser reads them; deciding
 *  they are not completions is the consumer's job, which keeps this pattern general. */
test("given — a non-Sky handover still parses, and is simply not a Sky reward", () => {
  const ev = parseLine("[Thu Jul 30 12:13:54 2026] You have been given: Void-Touched Potential");
  assert.equal(ev?.type, "given");
  if (ev?.type === "given") assert.equal(matchSkyItem(ev.item), null);
});
