// Application controller: owns the engine + tailer for the active log and turns
// the raw line stream into live snapshots. The server talks only to this.

import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { listLogs, parseLogFileName } from "./config.js";
import { parseLine } from "./parser/parser.js";
import { Engine } from "./engine/engine.js";
import { Tailer } from "./tailer/tailer.js";
import { inventoryPathFor, readInventory } from "./parser/inventory.js";
import type { Fight, FightSummary, LogFileInfo, ParseMode } from "./types.js";

export class App {
  private readonly config: AppConfig;
  private engine: Engine;
  private tailer: Tailer | null = null;
  private logDir: string | null; // the actively scanned folder (changeable at runtime)
  private activeLogPath: string | null = null;
  /** mtime of the inventory export currently loaded, so the poll can skip re-parsing. */
  private inventoryMs: number | null = null;
  private onUpdate: () => void = () => {};
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.logDir = config.logDir;
    this.engine = this.newEngine(null);
    // Wall-clock tick so idle encounters/fights expire (and the UI refreshes)
    // even when no new log lines are arriving.
    setInterval(() => {
      const had = this.engine.hasCurrent;
      const closed = this.engine.tick();
      if (this.refreshInventory()) this.scheduleBroadcast();
      else if (had || closed) this.scheduleBroadcast();
    }, 3000).unref?.();
  }

  /** Register a callback fired (throttled) whenever engine state changes. */
  setUpdateHandler(fn: () => void): void {
    this.onUpdate = fn;
  }

  logs(): { logDir: string | null; activeLogPath: string | null; logs: LogFileInfo[] } {
    const logs = this.logDir ? listLogs(this.logDir) : [];
    return { logDir: this.logDir, activeLogPath: this.activeLogPath, logs };
  }

  /**
   * Point the parser at a different logs folder (e.g. on another machine).
   * Validates the path, repopulates the log list, and auto-selects the newest log.
   */
  setLogDir(dir: string): { ok: boolean; error?: string } {
    const trimmed = dir.trim();
    try {
      if (!fs.statSync(trimmed).isDirectory()) return { ok: false, error: "Not a folder" };
    } catch {
      return { ok: false, error: "Folder not found" };
    }
    this.logDir = trimmed;
    const newest = listLogs(trimmed)[0];
    if (newest) this.setActiveLog(newest.path, "backfill");
    else this.scheduleBroadcast();
    return { ok: true };
  }

  getActiveLogPath(): string | null {
    return this.activeLogPath;
  }

  /** Switch the actively parsed log, resetting engine state. */
  setActiveLog(logPath: string, mode: ParseMode = "backfill"): void {
    this.tailer?.stop();
    this.activeLogPath = logPath;
    this.engine = this.newEngine(logPath);
    // Before the backfill, not after: the engine filters Sky pickups against the export's
    // mtime, so the baseline has to be in place while the log is being replayed.
    this.inventoryMs = null;
    this.refreshInventory();

    this.tailer = new Tailer({ path: logPath, fromStart: mode === "backfill", pollIntervalMs: 1000 });
    this.tailer.onData((line) => this.handleLine(line));
    this.tailer.start();
    this.scheduleBroadcast();
  }

  snapshot(): ReturnType<Engine["snapshot"]> {
    return this.engine.snapshot();
  }

  fightSummaries(): FightSummary[] {
    // Reuse the engine's summary shape via snapshot for recent + current.
    const snap = this.engine.snapshot();
    const all = [...snap.recent];
    if (snap.current) {
      all.push({
        id: snap.current.id,
        title: snap.current.title,
        startMs: snap.current.startMs,
        endMs: snap.current.endMs,
        active: snap.current.active,
        durationSec: Math.round(((snap.current.endMs ?? Date.now()) - snap.current.startMs) / 1000),
        topDps: snap.current.combatants.find((c) => c.kind !== "npc")?.damage.perSec ?? 0,
      });
    }
    return all.reverse();
  }

  fight(id: string): Fight | null {
    return this.engine.fights().find((f) => f.id === id) ?? null;
  }

  /** Re-read the inventory export when the game has rewritten it, and hand it to the engine.
   *
   *  Polled on the existing 3s tick rather than watched: it is one `stat` of one file, the
   *  player writes it by hand with `/outputfile inventory`, and a few seconds of lag on a
   *  manual action is imperceptible — where an `fs.watch` here would mean a second watcher
   *  with its own rotation and platform quirks for no gain.
   *
   *  Returns whether anything changed, so the caller can push only when it did. */
  private refreshInventory(): boolean {
    const logPath = this.activeLogPath;
    const invPath = logPath ? inventoryPathFor(logPath) : null;
    if (!invPath) {
      if (this.inventoryMs === null) return false;
      this.inventoryMs = null;
      this.engine.setInventory(null);
      return true;
    }
    const inv = readInventory(invPath);
    // mtime is the whole test: the file is rewritten wholesale, so an unchanged mtime is an
    // unchanged file, and re-parsing 400 lines every 3s to prove it would be pure waste.
    if ((inv?.modifiedMs ?? null) === this.inventoryMs) return false;
    this.inventoryMs = inv?.modifiedMs ?? null;
    this.engine.setInventory(inv);
    return true;
  }

  private newEngine(logPath: string | null): Engine {
    const character = logPath ? parseLogFileName(path.basename(logPath)).character : null;
    return new Engine({
      selfName: character ?? "You",
      inactivityTimeoutSec: this.config.inactivityTimeoutSec,
    });
  }

  private handleLine(line: string): void {
    const ev = parseLine(line);
    if (!ev) return;
    this.engine.handle(ev);
    this.scheduleBroadcast();
  }

  /** Debounce broadcasts so a burst of new lines yields one push. */
  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.onUpdate();
    }, 200);
  }
}
