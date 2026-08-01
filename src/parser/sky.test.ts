import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchSkyItem, normalizeItemName, skyItemNames } from "./sky.js";
import { SKY_CLASSES } from "./sky-catalogue.js";
import { readInventory, inventoryPathFor } from "./inventory.js";

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

test("inventory — path sits one level above the logs folder, same character and server", () => {
  const p = inventoryPathFor("/games/EverQuest Legends/logs/eqlog_Sanluen_freeport.txt");
  assert.equal(p, path.join("/games/EverQuest Legends", "Sanluen_freeport-Inventory.txt"));
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
