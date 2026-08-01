// Regenerates `src/parser/sky-catalogue.ts` from the EverQuest Legends wiki.
//
//   node scripts/build-sky-quests.mjs
//
// The Plane of Sky class quests are a fixed table of game facts, so they are baked into the
// binary rather than fetched at runtime — the app is offline-first and must work with no
// network. This script is how that table is re-derived when the wiki changes; the generated
// file says so at the top and should never be hand-edited.
//
// Two tables on the page are read:
//   - one per class, under an `<h3>Class (Quest Giver)</h3>` — quest, trigger, rune, items, reward
//   - the page-wide item table (`Item Name | Drops From | …`), which supplies each item's mob
//
// Both are plain wiki tables with no stable ids or classes, so they are matched by their header
// row. That is deliberately strict: a header that stops matching fails the run loudly instead of
// silently writing an empty catalogue.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://eqlwiki.com/Plane_of_Sky";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "parser", "sky-catalogue.ts");

/** The island shorthand the quest tables use, spelled out. Keys are verbatim from the wiki —
 *  a few rows carry a bare island number, and Magician's Test of Displacement cites `7-Trash`. */
const ISLANDS = {
  "2-PoS": "Island 2 — Azarack",
  "3-Gorga": "Island 3 — Harpy",
  "4-KoS": "Island 4 — Pegasus",
  "5-SL": "Island 5 — Spiroc",
  "6-BZ": "Island 6 — Bee",
  "7-SotS": "Island 7 — Drake",
  "8-EoV": "Island 8 — Veeshan",
  "7-Trash": "Island 7 — trash",
  6: "Island 6 — Bee",
  7: "Island 7 — Drake",
};

const CLASS_CODES = {
  Bard: "BRD",
  Beastlord: "BST",
  Berserker: "BER",
  Cleric: "CLR",
  Druid: "DRU",
  Enchanter: "ENC",
  Magician: "MAG",
  Monk: "MNK",
  Necromancer: "NEC",
  Paladin: "PAL",
  Ranger: "RNG",
  Rogue: "ROG",
  "Shadow Knight": "SHD",
  Shaman: "SHM",
  Warrior: "WAR",
  Wizard: "WIZ",
};

const unescapeHtml = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'");

/** One row's cells, with `<br>` and list breaks preserved as `||` so multi-item cells survive. */
function cells(rowHtml) {
  const out = [];
  for (const m of rowHtml.matchAll(/<t[hd](?:[^>]*)>(.*?)<\/t[hd]>/gs)) {
    let c = m[1]
      .replace(/<br\s*\/?>/g, "||")
      .replace(/<\/li>/g, "||")
      .replace(/<[^>]+>/g, "");
    c = unescapeHtml(c).replace(/[ \t ]+/g, " ").trim();
    out.push(c.replace(/\s*\|\|\s*/g, "||").replace(/^\|+|\|+$/g, ""));
  }
  return out;
}

/** The wiki renders an item as its own name twice (tooltip title + body) followed by its stats.
 *  Halving the doubled prefix is what recovers the plain name. */
function undouble(text) {
  const first = text.split("\n")[0].trim();
  const half = first.length / 2;
  if (first.length % 2 === 0 && first.slice(0, half) === first.slice(half)) return first.slice(0, half);
  return first;
}

const rows = (tableHtml) => [...tableHtml.matchAll(/<tr(.*?)<\/tr>/gs)].map((m) => m[1]);

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${SOURCE} → HTTP ${res.status}`);
  const html = await res.text();

  // Item → the mob that drops it, from the page-wide loot table.
  const dropsFrom = new Map();
  for (const t of html.matchAll(/<table(.*?)<\/table>/gs)) {
    const rs = rows(t[1]);
    if (!rs.length) continue;
    const head = cells(rs[0]);
    if (head[0] !== "Item Name" || head[1] !== "Drops From") continue;
    for (const r of rs.slice(1)) {
      const c = cells(r);
      if (c.length < 2) continue;
      const from = c[1].replace(/\|\|/g, ", ").replace(/^[,\s]+|[,\s]+$/g, "");
      if (from && from !== "None?") dropsFrom.set(undouble(c[0]), from);
    }
    break;
  }

  // Walk headings and tables in document order: an `<h3>` names the class the next table belongs to.
  const classes = [];
  const unknownTags = new Set();
  let heading = null;
  for (const m of html.matchAll(/<h([2-4])[^>]*>(.*?)<\/h\1>|<table(.*?)<\/table>/gs)) {
    if (m[2] !== undefined) {
      const text = unescapeHtml(m[2].replace(/<[^>]+>/g, "")).replace(/\[edit\]/g, "").trim();
      heading = m[1] === "3" ? text : null;
      continue;
    }
    const rs = rows(m[3]);
    if (!rs.length || !heading) continue;
    const head = cells(rs[0]);
    if (head[0] !== "Quest" || head[1] !== "Quest Giver") continue;

    const named = /^(.*?)\s*\((.*)\)$/.exec(heading);
    const className = (named ? named[1] : heading).trim();
    const giver = named ? named[2].trim() : "";
    const code = CLASS_CODES[className];
    if (!code) throw new Error(`unknown class heading: ${heading}`);

    const quests = [];
    for (const r of rs.slice(1)) {
      const c = cells(r);
      if (c.length < 6) continue;
      const items = [];
      for (const raw of c[4].split("||")) {
        const item = raw.trim();
        if (!item) continue;
        const tagged = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(item);
        const name = (tagged ? tagged[1] : item).trim();
        const tag = tagged ? tagged[2].trim() : null;
        if (tag && !(tag in ISLANDS)) unknownTags.add(tag);
        items.push({ name, island: tag ? ISLANDS[tag] ?? null : null, dropsFrom: dropsFrom.get(name) ?? null });
      }
      // A quest awarding two items writes them as one cell joined by ", ".
      const rewards = c[5].split(/\|\|,\s*/).map(undouble).filter(Boolean);
      if (!rewards.length) throw new Error(`no reward parsed: ${className} / ${c[0]}`);
      quests.push({ quest: c[0], trigger: c[2], rune: c[3], items, rewards });
    }
    if (!quests.length) throw new Error(`no quests parsed for ${className}`);
    classes.push({ className, code, giver, quests });
  }

  if (classes.length !== Object.keys(CLASS_CODES).length) {
    throw new Error(`parsed ${classes.length} classes, expected ${Object.keys(CLASS_CODES).length}`);
  }
  if (unknownTags.size) throw new Error(`unrecognised island tags: ${[...unknownTags].join(", ")}`);

  classes.sort((a, b) => a.className.localeCompare(b.className));

  const questCount = classes.reduce((n, c) => n + c.quests.length, 0);
  const itemCount = classes.reduce((n, c) => n + c.quests.reduce((k, q) => k + q.items.length, 0), 0);

  const body = `// Plane of Sky class quests — generated from ${SOURCE}
// by scripts/build-sky-quests.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.
//
// ${classes.length} classes, ${questCount} quests, ${itemCount} required-item slots. The reward and item
// names are the wiki's verbatim; matching them against what the game writes is \`sky.ts\`'s job,
// because the two disagree on apostrophes and capitalisation.

import type { ClassCode } from "./spells.js";

export interface SkyQuestItem {
  name: string;
  /** Which island it drops on, spelled out; null when the wiki tags no island. */
  island: string | null;
  /** The mob the page-wide loot table names, when it lists one. */
  dropsFrom: string | null;
}

export interface SkyQuest {
  quest: string;
  /** What you say to the quest giver to be handed the rune. */
  trigger: string;
  /** The Wind Rune the giver hands over — a turn-in component, but obtained by asking
   *  rather than looted, so holding one means the quest is started rather than progressed. */
  rune: string;
  items: SkyQuestItem[];
  /** Usually one; Beastlord's Test of Claw awards a weapon in each hand. */
  rewards: string[];
}

export interface SkyClass {
  className: string;
  code: ClassCode;
  giver: string;
  quests: SkyQuest[];
}

export const SKY_CLASSES: readonly SkyClass[] = ${JSON.stringify(classes, null, 2)};
`;

  fs.writeFileSync(OUT, body);
  console.log(`wrote ${path.relative(ROOT, OUT)} — ${classes.length} classes, ${questCount} quests, ${itemCount} item slots`);
  const missing = new Set();
  for (const c of classes) for (const q of c.quests) for (const i of q.items) if (!i.dropsFrom) missing.add(i.name);
  console.log(`items with no drop-table row: ${missing.size} (island tag still known)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
