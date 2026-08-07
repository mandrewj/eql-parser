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
/** A second source for *where things drop*, which the wiki's loot table covers badly: it leaves
 *  25 of the 113 components with no mob at all, and gives the Efreeti items a different arbitrary
 *  subset of the same three cycle mobs each. This page states one `source` per item, as
 *  `Island <n>: <mob>` joined by ` / `. Quests, runes and rewards still come from the wiki alone. */
const DROPS_SOURCE = "https://eqlposky.com/data.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "parser", "sky-catalogue.ts");

/** Where the wiki's loot table is wrong, and we know better from playing. Applied after the page
 *  is read, so a re-run keeps the correction instead of quietly reverting to the wiki's answer.
 *  `null` means "no mob listed" — the panel groups those rows under a heading of their own rather
 *  than naming a mob that does not drop the item.
 *
 *  Keep this short and each entry justified: the wiki is the source of record, and every line here
 *  is a claim that it is mistaken. */
const DROPS_FROM_OVERRIDES = {
  // The wiki credits the Protector of Sky and eqlposky a greater sphinx. The sphinx matches the
  // item's own island tag (`7-Trash`), so it wins and the Protector is dropped outright.
  "Gem of Invigoration": { dropsFrom: "a greater sphinx" },
  // Both sources also list the Efreeti cycle for this one; the player says it comes off the Eye
  // and not the cycle. Replacing rather than unioning is the point — it moves the item out of
  // the cycle group and onto Island 8, where the mob that drops it lives.
  "Efreeti Great Staff": { dropsFrom: "Eye of Veeshan", island: "Island 8 — Veeshan" },
};

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

/** eqlposky numbers its islands where the wiki abbreviates them. Islands 1 and 1.5 (the entry
 *  island and the Efreeti quest room) have no entry here on purpose: nothing is *tagged* to them,
 *  and a source naming only those resolves to no island, which is the honest answer. */
const POSKY_ISLANDS = {
  "2": "Island 2 — Azarack",
  "3": "Island 3 — Harpy",
  "4": "Island 4 — Pegasus",
  "5": "Island 5 — Spiroc",
  "6": "Island 6 — Bee",
  "7": "Island 7 — Drake",
  "8": "Island 8 — Veeshan",
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

/** The wiki is inconsistent about apostrophes — `Spiritualist\`s Ring` and `Al\`Kabor's Cap`
 *  against `Griffon's Beak` — and a panel showing both spellings looks like a bug. Display is
 *  settled on the straight quote here; matching is unaffected, since `sky.ts` folds all three
 *  forms to the same key anyway. */
const tidyName = (s) => s.replace(/[`‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();

/** Item names for *matching between sources*, which disagree on capitalisation — the wiki writes
 *  `Crown Of Elemental Mastery`, eqlposky `Crown of Elemental Mastery`. The same folding `sky.ts`
 *  does at runtime for the game's own spelling, for the same reason. Never a display name. */
const foldKey = (s) => tidyName(s).toLowerCase();

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
      // "None?" and "Various" are the wiki saying it does not know, not naming a mob. Kept out
      // rather than filtered downstream: "Various" sorts first in a comma list and would become
      // a group heading, which is the one job a mob name has here.
      if (from && !/^(None\?|Various)$/i.test(from)) dropsFrom.set(foldKey(undouble(c[0])), from);
    }
    break;
  }
  // …then the second source, which is where most of the drop data actually comes from. Read by
  // regex rather than evaluated: this is a remote script, and a build step that runs one is a
  // supply-chain hole for a table of mob names. Their file quotes every string with `"` and
  // escapes nothing, which the strictness below re-checks on every run.
  const posky = await fetch(DROPS_SOURCE);
  if (!posky.ok) throw new Error(`${DROPS_SOURCE} → HTTP ${posky.status}`);
  const poskyText = await posky.text();
  // Either quote style: an entry whose source contains a quoted nickname is written with single
  // quotes instead (`source: 'Island 6: Bazzt Zzzt "Bees"'`), and a double-quote-only pattern
  // silently skipped exactly those. Nothing in the file is backslash-escaped, which the count
  // check below is what re-verifies.
  const quoted = `("[^"]*"|'[^']*')`;
  const pairRe = new RegExp(`name:\\s*${quoted}\\s*,\\s*source:\\s*${quoted}`, "g");
  const unquote = (s) => s.slice(1, -1);
  const poskySources = new Map();
  for (const m of poskyText.matchAll(pairRe)) poskySources.set(foldKey(unquote(m[1])), unquote(m[2]).trim());
  if (poskySources.size < 120) throw new Error(`${DROPS_SOURCE}: only ${poskySources.size} item sources parsed — shape changed?`);

  /** `Island 7: Sister of the Spire / Island 8: Eye of Veeshan` → the mob names, in order.
   *  A leading article is title-cased so "the Hand of Veeshan" and the wiki's "The Hand of
   *  Veeshan" are one name rather than two spellings across neighbouring rows. */
  const poskyMobs = (source) =>
    source
      // ` / ` separates islands; within one, a comma separates mobs. Exactly one entry uses the
      // comma form ("Island 4: essence/soul mobs, Eternal Spirit") and no mob name contains one,
      // which is what makes splitting on it safe rather than clever.
      .split(/ \/ |,\s+/)
      .map((s) =>
        s
          .replace(/^Island [\d.]+:\s*/, "")
          .replace(/\s*"[^"]*"\s*$/, "")
          .replace(/^the (?=[A-Z])/, "The ")
          .trim(),
      )
      .filter(Boolean);

  /** A collective ("bee mobs", "drake/sphinx/spirit mobs") rather than a mob's name. Worth having
   *  when it is all we know, and pure noise beside the wiki's specific names — appending it to
   *  "a greater sphinx, a heartsbane drake, an undine spirit" says the same thing twice, vaguely
   *  the second time. */
  const isCollective = (mob) => /\bmobs\b/i.test(mob);

  /** …and the island, but only when every mob it names is on the same one. Several islands means
   *  the Efreeti cycle, which is precisely the case the wiki tags with no island — so "no island"
   *  survives as the answer rather than being overwritten by whichever number came first. */
  const poskyIsland = (source) => {
    const nums = [...new Set([...source.matchAll(/Island ([\d.]+)/g)].map((m) => m[1]))];
    return nums.length === 1 ? POSKY_ISLANDS[nums[0]] ?? null : null;
  };

  // Union, wiki first: the second source **fills gaps and adds names, never removes one**. The
  // wiki is often the more specific of the two ("Bazzzazzt, Bizazzzt, Bzzzt" against "bee mobs"),
  // and a rule that simply preferred the newer source would throw that away.
  const islandFromDrops = new Map();
  for (const [item, source] of poskySources) {
    const mobs = poskyMobs(source);
    if (!mobs.length) continue;
    const existing = dropsFrom.get(item);
    const have = existing ? existing.split(",").map((s) => s.trim()) : [];
    // `Bazzt Zzzt (Island 6 Boss)` and `Bazzt Zzzt` are one mob — the wiki's parenthetical is a
    // note, not part of the name, so it must not make the same mob look like two.
    const norm = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
    for (const mob of mobs) {
      if (isCollective(mob) && have.length) continue;
      if (!have.some((h) => norm(h) === norm(mob))) have.push(mob);
    }
    if (have.length) dropsFrom.set(item, have.join(", "));
    const isl = poskyIsland(source);
    if (isl) islandFromDrops.set(item, isl);
  }

  // …then our corrections, which outrank both and **replace** rather than union — the whole point
  // of one is that a source is wrong, and a union would keep the wrong answer alongside the right.
  // An override naming an item neither page lists is a stale correction, and saying so is the
  // point: it fails rather than sitting there doing nothing.
  for (const [name, o] of Object.entries(DROPS_FROM_OVERRIDES)) {
    const item = foldKey(name);
    if (!dropsFrom.has(item) && !poskySources.has(item)) {
      throw new Error(`override for an item neither source lists: ${name}`);
    }
    if (o.dropsFrom === null) dropsFrom.delete(item);
    else if (o.dropsFrom) dropsFrom.set(item, o.dropsFrom);
    if (o.island) islandFromDrops.set(item, o.island);
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
        const clean = tidyName(name);
        // The wiki's own tag wins when it has one; otherwise the island implied by the mob that
        // drops it, which is how `Efreeti Statuette` stops being an Efreeti-cycle item. An
        // override's island beats both, since it is the one claim a person made deliberately.
        const overrideIsland = DROPS_FROM_OVERRIDES[clean]?.island;
        const island = overrideIsland ?? (tag ? ISLANDS[tag] ?? null : null) ?? islandFromDrops.get(foldKey(clean)) ?? null;
        items.push({ name: clean, island, dropsFrom: dropsFrom.get(foldKey(clean)) ?? null });
      }
      // A quest awarding two items writes them as one cell joined by ", ".
      const rewards = c[5].split(/\|\|,\s*/).map(undouble).map(tidyName).filter(Boolean);
      if (!rewards.length) throw new Error(`no reward parsed: ${className} / ${c[0]}`);
      quests.push({ quest: tidyName(c[0]), trigger: c[2], rune: tidyName(c[3]), items, rewards });
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
// ${classes.length} classes, ${questCount} quests, ${itemCount} required-item slots. Names are the wiki's, with
// its mixed apostrophes settled on the straight quote so the panel does not show two spellings
// of the same punctuation. Matching them against what the game writes is \`sky.ts\`'s job — the
// game adds \`+N\`/\`(Exaltation)\` suffixes and disagrees on capitalisation.

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
  /** What you say to the quest giver. */
  trigger: string;
  /** The Wind Rune this test consumes. A looted component like the others, not something the
   *  giver hands over: the wiki says the runes "drop from all mobs in the Plane of Sky". One
   *  rune serves quests in several classes, and each turn-in consumes one. */
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
