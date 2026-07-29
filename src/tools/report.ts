// Replay the active log through the engine and print a report per fight.
// Run: npm run report            (all fights, damage summary)
//      npm run report -- <n>     (full damage/healing/tanking detail for fight #n)

import fs from "node:fs";
import { resolveLogDir, defaultLog, loadConfig } from "../config.js";
import { parseLine } from "../parser/parser.js";
import { Engine } from "../engine/engine.js";
import type { CombatantStats, Fight, MetricStat } from "../types.js";

const fmt = (n: number) => n.toLocaleString();
const time = (ms: number) => new Date(ms).toLocaleTimeString();

function metricTable(label: string, unit: string, rows: CombatantStats[], pick: (c: CombatantStats) => MetricStat): void {
  const active = rows.filter((c) => pick(c).total > 0);
  if (active.length === 0) return;
  console.log(`    ── ${label} ──`);
  for (const c of active) {
    const m = pick(c);
    const self = c.isSelf ? "*" : " ";
    console.log(`    ${self} ${c.name.padEnd(22)} ${fmt(m.perSec).padStart(7)} ${unit}  ${fmt(m.total).padStart(8)}`);
    for (const e of m.entries.slice(0, 10)) {
      console.log(`          · ${e.name.padEnd(24)} ${fmt(e.total).padStart(8)}  x${e.hits}${e.crits ? ` (${e.crits} crit)` : ""}`);
    }
  }
}

function printFight(fight: Fight, detail: boolean): void {
  const dur = Math.max(1, ((fight.endMs ?? fight.startMs) - fight.startMs) / 1000);
  console.log(`\n▸ ${fight.title}  [${time(fight.startMs)}, ${Math.round(dur)}s${fight.active ? ", ACTIVE" : ""}]`);

  const friendly = fight.combatants.filter((c) => c.kind !== "npc");
  const npcs = fight.combatants.filter((c) => c.kind === "npc");

  if (!detail) {
    for (const c of friendly.filter((c) => c.damage.total > 0)) {
      const m = c.damage;
      console.log(
        `  ${c.isSelf ? "*" : " "} ${c.name.padEnd(22)} ${fmt(m.perSec).padStart(7)} dps  ${fmt(m.total).padStart(8)}  (m ${m.byType.melee} / s ${m.byType.spell} / d ${m.byType.dot})`,
      );
    }
    return;
  }

  metricTable("Damage done", "dps", friendly, (c) => c.damage);
  metricTable("Healing done", "hps", friendly, (c) => c.healing);
  metricTable("Damage taken (tanking)", "dps", friendly, (c) => c.taken);

  const self = fight.combatants.find((c) => c.isSelf);
  if (self?.stances) {
    for (const [dim, label] of [
      ["melee", "melee stance"],
      ["invocation", "invocation"],
    ] as const) {
      const list = self.stances[dim];
      if (!list.length) continue;
      console.log(`    ── Self damage by ${label} ──`);
      for (const s of list) console.log(`      ${s.stance.padEnd(16)} ${fmt(s.total).padStart(8)}  ${fmt(s.dps)} dps  ${s.activeSeconds}s`);
    }
  }
  if (npcs.length) {
    console.log(`    ── NPC outgoing ──`);
    for (const c of npcs) console.log(`      ${c.name.padEnd(22)} ${fmt(c.damage.total).padStart(8)} dealt`);
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

  const engine = new Engine({ selfName: log.character ?? "You", inactivityTimeoutSec: cfg.inactivityTimeoutSec });
  for (const line of fs.readFileSync(log.path, "utf8").split(/\r?\n/)) {
    const ev = parseLine(line);
    if (ev) engine.handle(ev);
  }
  engine.endInput();

  const fights = engine.fights();
  const detailIdx = process.argv[2] ? Number(process.argv[2]) : null;
  console.log(`Fights detected: ${fights.length}  (self: ${log.character})`);
  fights.forEach((fight, i) => {
    const dur = ((fight.endMs ?? fight.startMs) - fight.startMs) / 1000;
    if (dur < 2 && detailIdx === null) return;
    console.log(`\n[#${i + 1}]`);
    printFight(fight, detailIdx === i + 1);
  });
}

main();
