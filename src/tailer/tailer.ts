// Log tailer: follows a growing log file and emits complete lines.
//
// - Byte-offset reads (only the new bytes each cycle).
// - CRLF-safe: strips trailing \r; buffers partial last lines until \n arrives.
// - Change detection via fs.watch AND a polling fallback (some writers/filesystems
//   don't emit reliable events; polling guarantees progress).
// - Rotation/truncation reset: if the file shrinks, we re-read from the top.
// - Re-opens by path each cycle so a replaced/rotated file is picked up.

import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** How much of a growing file to take per read. Live appends are a few hundred bytes and take
 *  one pass regardless; this exists for the **backfill**, where "the new bytes" is the whole
 *  171MB log. Reading that in one buffer cost 1.2GB of peak RSS — the buffer, the string it
 *  decodes to, and the 2.2M-entry array it splits into, all live at once — and blocked the event
 *  loop for the 13s it took to hand every line to the engine, so nothing answered on the port
 *  until the backfill had finished.
 *
 *  **The lasting cost was the surprising one.** A substring in V8 is a slice that references its
 *  parent, and the engine keeps names out of the lines it is given — abilities, mobs, zones. One
 *  retained name is therefore enough to pin the entire string it was cut from, so decoding the
 *  log in one piece kept all 171MB of it alive for the rest of the session. Chunking bounds what
 *  any such slice can hold to one chunk.
 *
 *  Measured on that log, same 2,182,907 lines emitted in the same order:
 *
 *  | | whole-file | 1MB chunks |
 *  |---|---|---|
 *  | first response on the port | 13.1s | 0.13s |
 *  | peak RSS during backfill | 1207MB | 580MB |
 *  | resident engine heap after | 400MB | 206MB |
 *
 *  Smaller chunks would yield more often, but 171 reads is already free next to the parsing. */
const READ_CHUNK_BYTES = 1 << 20;

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
  /** Holds a multi-byte character split across a chunk boundary — or across two polls, which
   *  the whole-file read could not encounter but a chunked one meets every 1MB. The log is
   *  effectively ASCII, so this is belt and braces; it costs nothing and removes the
   *  assumption rather than restating it. */
  private decoder = new StringDecoder("utf8");
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
        this.decoder = new StringDecoder("utf8");
      }
      if (stat.size === this.offset) return;

      // The size read once, up front: the file may well grow while we work through a backfill,
      // and chasing a moving end here would blur "catch up" into "follow". Whatever arrives
      // after this point is the next cycle's business, which is a second away at most.
      const end = stat.size;
      const fh = await fs.promises.open(this.path, "r");
      try {
        const buf = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, end - this.offset));
        while (this.offset < end) {
          if (this.stopped) return;
          const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, end - this.offset), this.offset);
          if (bytesRead === 0) break; // shorter than it claimed; the next cycle re-stats
          this.offset += bytesRead;
          this.pending += this.decoder.write(buf.subarray(0, bytesRead));
          // Split per chunk rather than once at the end: holding every line of a 171MB
          // backfill to split in one go is most of what made it a 1.2GB operation.
          const parts = this.pending.split("\n");
          this.pending = parts.pop() ?? "";
          for (const part of parts) {
            if (this.stopped) return;
            this.onLine(part.replace(/\r$/, ""));
          }
        }
      } finally {
        await fh.close();
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
