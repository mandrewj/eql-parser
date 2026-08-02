import { performance } from "node:perf_hooks";
import { SKY_CLASSES } from "./src/parser/sky-catalogue.js";
import { buildIslands, readyQuests, progressOf, resolveCompletions } from "./web/src/sky-model.js";
import { browseDir } from "./src/server/browse.js";
import fs from "node:fs";

const sky = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8"));
const held = new Map<string, number>(sky.held.map((h: { name: string; count: number }) => [h.name, h.count]));
const cat = SKY_CLASSES as never;

const bench = (label: string, n: number, fn: () => void) => {
  fn();
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  console.log(`  ${label.padEnd(44)} ${((performance.now() - t) / n).toFixed(4)} ms`);
};

console.log("--- Sky tab, per render pass ---");
bench("buildIslands (island view)", 500, () => { buildIslands(cat, held); });
bench("readyQuests (progress box)", 2000, () => { readyQuests(cat, held); });
bench("doneByClass (chip badges)", 2000, () => {
  const m = new Map<string, number>();
  for (const c of SKY_CLASSES) m.set(c.code, c.quests.filter((q) => progressOf(q, held).state === "done").length);
});
bench("resolveCompletions", 5000, () => { resolveCompletions(cat, sky.completed); });
let calls = 0;
for (const c of SKY_CLASSES) calls += c.quests.length;
console.log(`  (${calls} quests; buildIslands + readyQuests + doneByClass = 3 full passes)`);

console.log("\n--- folder picker, per request ---");
const B = process.env.HOME + "/Library/Application Support/osxEQL/prefix/drive_c/users/Public/Daybreak Game Company/Installed Games/EverQuest Legends";
bench("browseDir(install dir, 19 subdirs)", 20, () => { browseDir(B); });
bench("browseDir(logs dir, 0 subdirs)", 200, () => { browseDir(B + "/logs"); });
bench("browseDir(home)", 50, () => { browseDir(process.env.HOME!); });
