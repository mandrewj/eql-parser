import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchSkyItem, normalizeItemName, skyItemNames, skyQuestFromTurnIn } from "./sky.js";
import { SKY_CLASSES } from "./sky-catalogue.js";
import {
  readInventory,
  inventoryPathFor,
  inventoryCandidates,
  isUnexportedStorage,
  locationLabel,
} from "./inventory.js";
import { parseLogFileName, resolveLogDir } from "../config.js";
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

/**
 * The install root differs on every machine, so the export is located **relative to the open
 * log** and nothing else: up out of the logs folder, whatever that folder is called and however
 * deep it sits. These run the real derivation against `path.win32` and `path.posix`, so the
 * Windows layout is checked rather than assumed from a Mac.
 */
test("inventory — the Windows install layout resolves with backslashes", () => {
  const log = "C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends\\logs\\eqlog_Sanluen_freeport.txt";
  assert.deepEqual(inventoryCandidates(log, path.win32), [
    "C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends\\Sanluen_freeport-Inventory.txt",
    "C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends\\logs\\Sanluen_freeport-Inventory.txt",
  ]);
});

test("inventory — the macOS Wine-bottle layout resolves with forward slashes", () => {
  const log =
    "/Users/x/Library/Application Support/osxEQL/prefix/drive_c/users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/logs/eqlog_Sanluen_freeport.txt";
  assert.equal(
    inventoryCandidates(log, path.posix)[0],
    "/Users/x/Library/Application Support/osxEQL/prefix/drive_c/users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/Sanluen_freeport-Inventory.txt",
  );
});

/** Nothing keys off the folder being called `logs`, or off how deep the install sits — the rule
 *  is "the directory that holds the log's directory", which is true of any layout. */
test("inventory — the logs folder need not be named `logs`, at any depth", () => {
  assert.equal(
    inventoryCandidates("/srv/a/b/c/whatever/eqlog_Tester_erollisi.txt", path.posix)[0],
    "/srv/a/b/c/Tester_erollisi-Inventory.txt",
  );
  assert.equal(
    inventoryCandidates("D:\\games\\eql\\Logs\\eqlog_Tester_erollisi.txt", path.win32)[0],
    "D:\\games\\eql\\Tester_erollisi-Inventory.txt",
  );
});

/** Relative, so a relative log path stays relative rather than being resolved against cwd. */
test("inventory — a relative log path yields a relative export path", () => {
  assert.equal(inventoryCandidates("logs/eqlog_Tester_erollisi.txt", path.posix)[0], "Tester_erollisi-Inventory.txt");
});

test("inventory — the second candidate is the log's own folder, for a copied pair", () => {
  const [, beside] = inventoryCandidates("/copies/eqlog_Tester_erollisi.txt", path.posix);
  assert.equal(beside, "/copies/Tester_erollisi-Inventory.txt");
});

test("inventory — a file that is not an eqlog names no export", () => {
  assert.equal(inventoryPathFor("/games/EverQuest Legends/logs/dbg.txt"), null);
  assert.deepEqual(inventoryCandidates("/games/EverQuest Legends/logs/dbg.txt"), []);
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

/** Only the currency tab is genuinely invisible to the export.
 *
 *  The Dragon Hoard was on this list and should not have been. The measurement that put it there
 *  — "12 of 19 items stored there before an export appear nowhere in it" — was confounded: those
 *  items had been *spent* in the interval, so their absence said nothing about coverage. Items
 *  that were not spent do appear. Exempting it added every hoard pickup on top of an export that
 *  already counted it, so one High Quality Raiment read as three. */
test("storage — only the currency tab is outside the export's reach", () => {
  assert.equal(isUnexportedStorage("currency"), true);
  assert.equal(isUnexportedStorage("Currency"), true);
  assert.equal(isUnexportedStorage("Dragon Hoard"), false);
  assert.equal(isUnexportedStorage("tradeskill depot"), false);
  assert.equal(isUnexportedStorage(undefined), false); // an ordinary bag pickup
});

test("location — a slot name condenses to something a narrow column can carry", () => {
  assert.equal(locationLabel("General 3-Slot7"), "inv");
  assert.equal(locationLabel("Wrist"), "inv");
  assert.equal(locationLabel("Bank14-Slot1"), "bank");
  assert.equal(locationLabel("SharedBank2"), "shared");
  assert.equal(locationLabel("Personal-Depot1"), "depot");
  assert.equal(locationLabel("Equipment"), "keyring");
});

// --- the turn-in -----------------------------------------------------------------

test("trade — an offer names the item, the count and who it went to", () => {
  const ev = parseLine("[Sun Aug 02 16:16:46 2026] You offered 1 Wind Rune Dena to Torgon Blademaster.");
  assert.equal(ev?.type, "tradeOffer");
  if (ev?.type !== "tradeOffer") return;
  assert.equal(ev.item, "Wind Rune Dena");
  assert.equal(ev.count, 1);
  assert.equal(ev.to, "Torgon Blademaster");
});

test("trade — an offer carries the upgrade suffix, which folds away on matching", () => {
  const ev = parseLine("[Sun Aug 02 16:22:29 2026] You offered 1 High Quality Raiment +1 to Wizard Schrock.");
  assert.equal(ev?.type, "tradeOffer");
  if (ev?.type === "tradeOffer") assert.equal(matchSkyItem(ev.item)?.name, "High Quality Raiment");
});

test("trade — completion names the other side", () => {
  const ev = parseLine("[Sun Aug 02 16:16:47 2026] You complete the trade with Torgon Blademaster.");
  assert.equal(ev?.type, "tradeComplete");
  if (ev?.type === "tradeComplete") assert.equal(ev.to, "Torgon Blademaster");
});

/** A real log writes **no** reward line for a Sky turn-in, so the trade itself is what a
 *  completion has to be recognised by: the giver narrows it to one class, the items pick the
 *  quest. */
test("turn-in — the giver and what crossed the trade identify the quest", () => {
  const hit = skyQuestFromTurnIn("Torgon Blademaster", ["Wind Rune Dena", "Ethereal Emerald", "Efreeti Battle Axe"]);
  assert.equal(hit?.quest, "Warrior Test of Bash");
  assert.equal(hit?.reward, "Fangol");
});

test("turn-in — a partial offer is not a completion", () => {
  assert.equal(skyQuestFromTurnIn("Torgon Blademaster", ["Wind Rune Dena"]), null);
  assert.equal(skyQuestFromTurnIn("Torgon Blademaster", []), null);
});

test("turn-in — trading with someone who takes no Sky quest completes nothing", () => {
  assert.equal(skyQuestFromTurnIn("Mirad", ["Wind Rune Dena", "Ethereal Emerald", "Efreeti Battle Axe"]), null);
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

// --- finding the logs folder ---------------------------------------------------

/** The game creates the folder as `Logs`; this project has always looked for `logs`. macOS and
 *  Windows hide that, but a Wine bottle on a case-sensitive Linux filesystem would report no logs
 *  on a machine that has them. */
test("config — the logs folder is found whatever its capitalisation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eql-case-"));
  try {
    const real = path.join(root, "Logs");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "eqlog_Tester_erollisi.txt"), "");

    // Asserting the resolved *string* would only hold on one kind of filesystem: a
    // case-insensitive host satisfies the direct stat and returns the spelling asked for, while
    // a case-sensitive one falls through to the retry and returns the real name. What has to be
    // true on both is that the folder is found and it is the one holding the log.
    const found = (asked: string): string | null => {
      process.env.EQL_LOG_DIR = path.join(root, asked);
      return resolveLogDir();
    };
    for (const spelling of ["logs", "Logs", "LOGS"]) {
      const dir = found(spelling);
      assert.ok(dir, `asking for ${spelling} should find the folder`);
      assert.ok(
        fs.existsSync(path.join(dir!, "eqlog_Tester_erollisi.txt")),
        `${spelling} resolved to ${dir}, which does not hold the log`,
      );
    }
    assert.equal(found("nothing-here"), null);
  } finally {
    delete process.env.EQL_LOG_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
