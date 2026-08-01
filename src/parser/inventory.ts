// The character's inventory export — the baseline the Sky tracker counts from.
//
// In game, `/outputfile inventory` writes `<Char>_<server>-Inventory.txt` into the game folder
// (the *parent* of the logs folder). It is a tab-separated dump of every slot the character can
// see: worn equipment, every bag slot, both banks and the shared bank. That breadth is what makes
// it usable as a baseline — an item sitting in the bank counts as held just as much as a worn one.
//
//   Location            Name                         ID      Count   Slots
//   General 2-Slot4     Mote of Potential            148593  28      10
//   Face-Slot7          Polished Mithril Mask (Exaltation)  4505  1  10
//   Head-Slot2          Empty                        0       0       0
//
// **There are two sections, and the second is easy to lose.** After a blank line the file starts
// again with a `KeyRing / Name / ID` header and rows carrying only three columns:
//
//   KeyRing             Name                         ID
//   Equipment           Razing Sword of Skarlon +7   5412
//
// Those are real holdings, not repeats — in a real export none of the 17 keyring ids appears
// anywhere in the main section. A width check that requires the main section's five columns
// drops every one of them, which is precisely wrong for this tracker: a finished quest's reward
// is exactly the kind of item that ends up there. So a row is identified by its *header*
// (`Name` in the second column) rather than by how many columns it has, and a section with no
// `Count` column means one of the item.
//
// The file is a **snapshot**, not a feed: it is only as current as the last time it was written.
// So the tracker pairs it with its own mtime and replays loot from the log after that point,
// and re-reads it whenever the game rewrites it. `Empty` is the game's placeholder for an unused
// slot, not an item.

import fs from "node:fs";
import path from "node:path";
import { normalizeItemName } from "./sky.js";

export interface InventoryEntry {
  /** The game's spelling, upgrade suffix and all — kept for display and diagnosis. */
  raw: string;
  /** The game's item id. Equal for `Foo`, `Foo +4` and `Foo (Exaltation)`, which is the
   *  evidence that folding those together is right rather than merely convenient. */
  id: number;
  count: number;
  location: string;
}

export interface Inventory {
  path: string;
  /** When the game last wrote the file — the cut-off after which the log takes over. */
  modifiedMs: number;
  /** Normalised name → total count across every slot holding it. */
  counts: Map<string, number>;
  /** Normalised name → the entries that contributed, for "where is it" and for tests. */
  entries: Map<string, InventoryEntry[]>;
  /** How many non-empty slots were read; a sanity figure for the UI and the log. */
  itemCount: number;
}

/**
 * Auto-storages whose contents the export does **not** list.
 *
 * Proven rather than assumed for `currency`: a Wind Rune Azia was routed there at 13:20:57 and
 * is absent from an export written 51 seconds later, while two runes that went to a bag in the
 * same minutes are both present. The export has exactly two sections — the main slot dump and
 * the keyring — and neither has anywhere for it to be.
 *
 * The consequence is the whole reason this exists. Pickups are normally discarded when they
 * predate the export, since the export already counts them; but an item the export *cannot*
 * count is then discarded by the cut-off and restored by nothing — it becomes permanently
 * invisible. Plane of Sky wind runes are routed to the currency tab, so that is not a corner
 * case, it is every rune the character will ever loot.
 *
 * `Dragon Hoard` was measured the same way and is also absent. Of 19 distinct items stored there
 * before an export, 12 appear nowhere in it; the 7 that do are all in `Equipment` or a `Bank`
 * slot — separate copies of the same item, not the hoard's contents — and the file has no
 * `Dragon Hoard` location at all. This is not hypothetical either: a Grey Damask Cloak, the
 * Wizard's Test of Concentration component, was routed there.
 *
 * `tradeskill depot` is **not** listed, and that is a measurement too rather than caution: an
 * export carried a `Personal-Depot` section holding exactly the Black Sapphire, Blue Diamond and
 * Darkbone Marrow the log had stored there. The depot is covered, so exempting it would
 * double-count. A later export shows none of them only because the depot had been emptied.
 */
const UNEXPORTED_STORAGE = new Set(["currency", "dragon hoard"]);

/** Whether a pickup's destination is one the export cannot vouch for, making the log the only
 *  witness that the item was obtained at all. */
export function isUnexportedStorage(storedIn: string | undefined): boolean {
  return storedIn !== undefined && UNEXPORTED_STORAGE.has(storedIn.trim().toLowerCase());
}

/** Where the export lives for a given log file: same character and server, one directory up
 *  from `logs/`. Returns a path whether or not it exists — the caller reports the absence. */
export function inventoryPathFor(logPath: string): string | null {
  const m = /^eqlog_([^_]+)_(.+)\.txt$/i.exec(path.basename(logPath));
  if (!m) return null;
  const gameDir = path.dirname(path.dirname(logPath));
  return path.join(gameDir, `${m[1]}_${m[2]}-Inventory.txt`);
}

/** Read and fold an inventory export. Returns null when the file is absent or unreadable —
 *  a missing export is the normal state until the player runs `/outputfile inventory`, so it
 *  is not an error, just an empty baseline. */
export function readInventory(filePath: string): Inventory | null {
  let text: string;
  let modifiedMs: number;
  try {
    modifiedMs = fs.statSync(filePath).mtimeMs;
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const counts = new Map<string, number>();
  const entries = new Map<string, InventoryEntry[]>();
  let itemCount = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const [location, raw, idText, countText] = cols as [string, string, string, string?];
    // Both sections label their second column `Name`, so this skips either header without
    // caring which section we are in — and without assuming a column count.
    if (raw === "Name") continue;
    if (!raw || raw === "Empty") continue;

    // A stack of 28 motes is one slot holding 28; a worn item is one holding 1. The game
    // writes 0 for a few slot kinds, which still means the item is there — and the keyring
    // section has no count column at all.
    const count = Number(countText);
    const entry: InventoryEntry = {
      raw,
      id: Number(idText) || 0,
      count: Number.isFinite(count) && count > 0 ? count : 1,
      location,
    };
    const key = normalizeItemName(raw);
    counts.set(key, (counts.get(key) ?? 0) + entry.count);
    const list = entries.get(key);
    if (list) list.push(entry);
    else entries.set(key, [entry]);
    itemCount += 1;
  }

  return { path: filePath, modifiedMs, counts, entries, itemCount };
}
