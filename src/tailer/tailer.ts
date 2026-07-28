// Log tailer: follows a growing log file and emits complete lines.
// Byte-offset reads, CRLF/partial-line handling, watch + polling fallback,
// and rotation/truncation reset are implemented in M3.

export interface TailerOptions {
  path: string;
  fromStart?: boolean; // backfill whole file first, then follow (default: follow from EOF)
  pollIntervalMs?: number;
}

export type LineHandler = (line: string) => void;

export class Tailer {
  private readonly opts: TailerOptions;
  private onLine: LineHandler = () => {};

  constructor(opts: TailerOptions) {
    this.opts = opts;
  }

  onData(handler: LineHandler): void {
    this.onLine = handler;
  }

  start(): void {
    // TODO(M3): open file, seek to offset, watch + poll, emit lines via this.onLine.
    void this.opts;
    void this.onLine;
  }

  stop(): void {
    // TODO(M3): tear down watchers/timers so the active log can be switched at runtime.
  }
}
