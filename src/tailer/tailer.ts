// Log tailer: follows a growing log file and emits complete lines.
//
// - Byte-offset reads (only the new bytes each cycle).
// - CRLF-safe: strips trailing \r; buffers partial last lines until \n arrives.
// - Change detection via fs.watch AND a polling fallback (some writers/filesystems
//   don't emit reliable events; polling guarantees progress).
// - Rotation/truncation reset: if the file shrinks, we re-read from the top.
// - Re-opens by path each cycle so a replaced/rotated file is picked up.

import fs from "node:fs";

export interface TailerOptions {
  path: string;
  fromStart?: boolean; // parse the whole file first, then follow (default: follow from EOF)
  pollIntervalMs?: number;
}

export type LineHandler = (line: string) => void;

export class Tailer {
  private readonly path: string;
  private readonly fromStart: boolean;
  private readonly pollIntervalMs: number;

  private offset = 0;
  private pending = ""; // incomplete trailing line
  private onLine: LineHandler = () => {};
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private reading = false;
  private rereadRequested = false;
  private stopped = false;

  constructor(opts: TailerOptions) {
    this.path = opts.path;
    this.fromStart = opts.fromStart ?? false;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
  }

  onData(handler: LineHandler): void {
    this.onLine = handler;
  }

  start(): void {
    this.stopped = false;
    // Seek to EOF for live-only mode so we don't replay history.
    if (!this.fromStart) {
      try {
        this.offset = fs.statSync(this.path).size;
      } catch {
        this.offset = 0;
      }
    }
    void this.readNew();

    try {
      this.watcher = fs.watch(this.path, () => void this.readNew());
    } catch {
      // No watch (file missing yet / platform quirk) — polling covers it.
    }
    this.timer = setInterval(() => void this.readNew(), this.pollIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async readNew(): Promise<void> {
    if (this.stopped) return;
    if (this.reading) {
      this.rereadRequested = true;
      return;
    }
    this.reading = true;
    try {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(this.path);
      } catch {
        return; // file not present right now
      }

      if (stat.size < this.offset) {
        // Truncated or rotated — start over.
        this.offset = 0;
        this.pending = "";
      }
      if (stat.size === this.offset) return;

      const length = stat.size - this.offset;
      const fh = await fs.promises.open(this.path, "r");
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, this.offset);
        this.offset = stat.size;
        this.pending += buf.toString("utf8"); // log is ASCII; safe to decode chunk-wise
      } finally {
        await fh.close();
      }

      const parts = this.pending.split("\n");
      this.pending = parts.pop() ?? "";
      for (const part of parts) {
        if (this.stopped) return;
        this.onLine(part.replace(/\r$/, ""));
      }
    } finally {
      this.reading = false;
      if (this.rereadRequested && !this.stopped) {
        this.rereadRequested = false;
        void this.readNew();
      }
    }
  }
}
