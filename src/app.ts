// Application controller: owns the engine + tailer for the active log and turns
// the raw line stream into live snapshots. The server talks only to this.

import path from "node:path";
import type { AppConfig } from "./config.js";
import { listLogs, parseLogFileName } from "./config.js";
import { parseLine } from "./parser/parser.js";
import { Engine } from "./engine/engine.js";
import { Tailer } from "./tailer/tailer.js";
import type { Fight, FightSummary, LogFileInfo, ParseMode } from "./types.js";

export class App {
  private readonly config: AppConfig;
  private engine: Engine;
  private tailer: Tailer | null = null;
  private activeLogPath: string | null = null;
  private mode: ParseMode = "backfill";
  private onUpdate: () => void = () => {};
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.engine = this.newEngine(null);
  }

  /** Register a callback fired (throttled) whenever engine state changes. */
  setUpdateHandler(fn: () => void): void {
    this.onUpdate = fn;
  }

  logs(): { logDir: string | null; activeLogPath: string | null; logs: LogFileInfo[] } {
    const logs = this.config.logDir ? listLogs(this.config.logDir) : [];
    return { logDir: this.config.logDir, activeLogPath: this.activeLogPath, logs };
  }

  getActiveLogPath(): string | null {
    return this.activeLogPath;
  }

  /** Switch the actively parsed log, resetting engine state. */
  setActiveLog(logPath: string, mode: ParseMode = "backfill"): void {
    this.tailer?.stop();
    this.mode = mode;
    this.activeLogPath = logPath;
    this.engine = this.newEngine(logPath);

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
