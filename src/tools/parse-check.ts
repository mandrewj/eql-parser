// Diagnostic: run the parser over the active log and print an event histogram
// plus any combat-relevant lines it failed to classify. Run: npm run parse:check

import fs from "node:fs";
import { resolveLogDir, defaultLog } from "../config.js";
import { parseLine } from "../parser/parser.js";
import type { CombatEvent } from "../types.js";

const RELEVANT =
  /for \d+ points? of (?:non-melee )?damage|has taken \d+ damage from|(?:heals|healed) .+ for \d+(?: \(\d+\))? hit points|have slain |has been slain by |, but miss(?:es)?!|You assume an? .+ stance\./;

function main(): void {
  const dir = resolveLogDir();
  const log = dir ? defaultLog(dir) : null;
  if (!log) {
    console.error("No log found. Set EQL_LOG_DIR to your logs folder.");
    process.exit(1);
  }

  const text = fs.readFileSync(log.path, "utf8");
  const counts: Record<CombatEvent["type"], number> = {
    melee: 0,
    spell: 0,
    dot: 0,
    miss: 0,
    death: 0,
    stance: 0,
    heal: 0,
    pet: 0,
    zone: 0,
  };
  let total = 0;
  let damageTotal = 0;
  const unparsed: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    total++;
    const ev = parseLine(line);
    if (ev) {
      counts[ev.type]++;
      if (ev.type === "melee" || ev.type === "spell" || ev.type === "dot") damageTotal += ev.amount;
    } else if (RELEVANT.test(line)) {
      unparsed.push(line);
    }
  }

  console.log(`Log            : ${log.fileName} (${log.character ?? "?"})`);
  console.log(`Lines scanned  : ${total.toLocaleString()}`);
  console.log("Events parsed  :");
  for (const [type, n] of Object.entries(counts)) {
    console.log(`  ${type.padEnd(7)}: ${n.toLocaleString()}`);
  }
  console.log(`Total damage   : ${damageTotal.toLocaleString()}`);
  console.log(`Unparsed (combat-relevant): ${unparsed.length}`);
  for (const line of unparsed.slice(0, 15)) console.log(`  ! ${line}`);
}

main();
