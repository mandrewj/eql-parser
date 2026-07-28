// Replay the active log through the engine and print a DPS report per fight.
// Run: npm run report            (all fights, summary)
//      npm run report -- <n>     (also show full detail for fight #n)

import fs from "node:fs";
import { resolveLogDir, defaultLog, loadConfig } from "../config.js";
import { parseLine } from "../parser/parser.js";
import { Engine } from "../engine/engine.js";
import type { Fight } from "../types.js";

function fmt(n: number): string {
  return n.toLocaleString();
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

function printFight(fight: Fight, detail: boolean): void {
  const dur = Math.max(1, ((fight.endMs ?? fight.startMs) - fight.startMs) / 1000);
  const friendlies = fight.combatants.filter((c) => c.kind !== "npc");
  const npcs = fight.combatants.filter((c) => c.kind === "npc");
  console.log(
    `\n▸ ${fight.title}  [${timeOf(fight.startMs)}, ${Math.round(dur)}s${fight.active ? ", ACTIVE" : ""}]`,
  );
  for (const c of friendlies) {
    const self = c.isSelf ? "*" : " ";
    console.log(
      `  ${self} ${c.name.padEnd(22)} ${fmt(c.dps).padStart(7)} dps  ${fmt(c.total).padStart(8)}  ${String(c.pct).padStart(5)}%  (m ${c.byType.melee} / s ${c.byType.spell} / d ${c.byType.dot})`,
    );
    if (detail) {
      for (const a of c.abilities.slice(0, 6)) {
        console.log(`        · ${a.name.padEnd(24)} ${fmt(a.total).padStart(7)}  x${a.hits}${a.crits ? ` (${a.crits} crit)` : ""}`);
      }
      if (c.stances?.length) {
        console.log(
          `        stances: ${c.stances.map((s) => `${s.stance} ${fmt(s.total)}@${s.dps}dps/${s.activeSeconds}s`).join("  ")}`,
        );
      }
    }
  }
  if (detail && npcs.length) {
    console.log(`    — NPC outgoing —`);
    for (const c of npcs) {
      console.log(`      ${c.name.padEnd(22)} ${fmt(c.total).padStart(8)} dealt  ${c.hits} hits, ${c.misses} miss`);
    }
  }
}

function main(): void {
  const cfg = loadConfig();
  const dir = resolveLogDir();
  const log = dir ? defaultLog(dir) : null;
  if (!log) {
    console.error("No log found. Set EQL_LOG_DIR.");
    process.exit(1);
  }

  const engine = new Engine({
    selfName: log.character ?? "You",
    inactivityTimeoutSec: cfg.inactivityTimeoutSec,
  });

  const text = fs.readFileSync(log.path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const ev = parseLine(line);
    if (ev) engine.handle(ev);
  }
  engine.endInput();

  const fights = engine.fights();
  const detailIdx = process.argv[2] ? Number(process.argv[2]) : null;

  console.log(`Fights detected: ${fights.length}  (self: ${log.character})`);
  fights.forEach((fight, i) => {
    const dur = ((fight.endMs ?? fight.startMs) - fight.startMs) / 1000;
    // Skip trivial blips in the summary unless asked for detail.
    if (dur < 2 && detailIdx === null) return;
    const showDetail = detailIdx !== null && detailIdx === i + 1;
    console.log(`\n[#${i + 1}]`);
    printFight(fight, showDetail);
  });
}

main();
