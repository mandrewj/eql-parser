// Configuration + log-file discovery.
//
// Only the *default log directory* is OS-specific; everything else is portable.
// Override the directory with the EQL_LOG_DIR environment variable.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { LogFileInfo } from "./types.js";

export interface AppConfig {
  port: number;
  logDir: string | null; // resolved directory we scan for logs (null if none found)
  inactivityTimeoutSec: number; // fight-close timeout
}

/** The install layout below the drive root is identical everywhere — only the root differs.
 *  The macOS Wine bottle spells the Windows one out for us: it mirrors `drive_c/users/Public`,
 *  so a real Windows install puts the logs under the **Public** user, not the current one. */
const GAME_LOGS = path.join(
  "Daybreak Game Company",
  "Installed Games",
  "EverQuest Legends",
  "logs",
);

const MACOS_DEFAULT = path.join(
  os.homedir(),
  "Library/Application Support/osxEQL/prefix/drive_c/users/Public",
  GAME_LOGS,
);

/** Candidate log directories in priority order for the current platform. */
export function candidateLogDirs(): string[] {
  const fromEnv = process.env.EQL_LOG_DIR;
  if (fromEnv) return [fromEnv];

  switch (process.platform) {
    case "darwin":
      return [MACOS_DEFAULT];
    case "win32":
      return [
        // %PUBLIC% is normally C:\Users\Public; the literal is the fallback for the rare
        // machine where it is unset. The old guess used the *current* user's home, which is
        // not where the installer puts them.
        path.join(process.env.PUBLIC ?? "C:\\Users\\Public", GAME_LOGS),
        // …and the current user's home last, in case of a per-user install.
        path.join(os.homedir(), GAME_LOGS),
      ];
    default:
      // Linux/Wine — the same bottle layout macOS uses.
      return [path.join(os.homedir(), ".wine/drive_c/users/Public", GAME_LOGS)];
  }
}

/** First candidate directory that actually exists, or null. */
export function resolveLogDir(): string | null {
  for (const dir of candidateLogDirs()) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // not present; try next
    }
  }
  return null;
}

/** Parse "eqlog_<Char>_<server>.txt" → character + server. */
export function parseLogFileName(fileName: string): {
  character: string | null;
  server: string | null;
} {
  const m = /^eqlog_([^_]+)_(.+)\.txt$/i.exec(fileName);
  if (!m) return { character: null, server: null };
  return { character: m[1] ?? null, server: m[2] ?? null };
}

/** All eqlog_*.txt files in a directory, newest first. */
export function listLogs(dir: string): LogFileInfo[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const logs: LogFileInfo[] = [];
  for (const fileName of entries) {
    if (!/^eqlog_.+\.txt$/i.test(fileName)) continue;
    const full = path.join(dir, fileName);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const { character, server } = parseLogFileName(fileName);
    logs.push({
      path: full,
      fileName,
      character,
      server,
      sizeBytes: stat.size,
      modifiedMs: stat.mtimeMs,
    });
  }

  logs.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return logs;
}

/** The newest log in the resolved directory, if any. */
export function defaultLog(dir: string): LogFileInfo | null {
  return listLogs(dir)[0] ?? null;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.EQL_PORT ?? 8787);
  const inactivityTimeoutSec = Number(process.env.EQL_INACTIVITY_SEC ?? 90);
  return {
    port: Number.isFinite(port) ? port : 8787,
    logDir: resolveLogDir(),
    inactivityTimeoutSec: Number.isFinite(inactivityTimeoutSec)
      ? inactivityTimeoutSec
      : 20,
  };
}
