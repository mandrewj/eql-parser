// Directory browsing for the logs-folder picker.
//
// A browser cannot do this. `showDirectoryPicker()` hands back an opaque handle and
// `<input webkitdirectory>` hands back paths relative to the chosen folder — both deliberately
// withhold the absolute path, which is the one thing the backend needs. So the browsing happens
// here and the UI renders the result. The server already binds to 127.0.0.1 only and its whole
// job is reading this machine's disk, so listing directories on request adds no reach it did not
// already have.
//
// What makes the picker quick is the **log count beside each folder**: you are looking for the
// one directory that holds `eqlog_*.txt`, and being told which one that is beats recognising the
// name. It costs one `readdir` per subdirectory, which is cheap at real directory sizes (the
// install folder has 6,156 entries but only 19 subdirectories, and scanning them all takes
// ~34ms) — but "cheap at real sizes" is not "bounded", so the scan is capped.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { candidateLogDirs } from "../config.js";

/** Subdirectories scanned for logs before the rest are listed without a count. A folder with
 *  hundreds of children is not one you are picking by eye anyway. */
const SCAN_LIMIT = 100;

const isLog = (name: string): boolean => /^eqlog_.+\.txt$/i.test(name);

export interface BrowseEntry {
  name: string;
  /** `eqlog_*.txt` directly inside it, or null when it was past the scan cap or unreadable. */
  logs: number | null;
}

export interface BrowseResult {
  path: string;
  /** The directory above, or null at a filesystem root. */
  parent: string | null;
  dirs: BrowseEntry[];
  /** Logs directly in `path` — what makes this folder the answer. */
  logs: number;
  /** One-click destinations: the platform's expected install, and home. */
  shortcuts: Array<{ label: string; path: string }>;
  error?: string;
}

/** Count `eqlog_*.txt` in a directory, or null if it cannot be read. */
function countLogs(dir: string): number | null {
  try {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() && isLog(e.name)) n++;
    }
    return n;
  } catch {
    return null; // permission denied, or it vanished between listing and reading
  }
}

function shortcuts(): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = [];
  const seen = new Set<string>();
  for (const dir of candidateLogDirs()) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    // Only offer a default that is actually there — a dead shortcut is worse than none.
    try {
      if (fs.statSync(dir).isDirectory()) out.push({ label: "EverQuest Legends logs", path: dir });
    } catch {
      /* not installed here */
    }
  }
  const home = os.homedir();
  if (!seen.has(home)) out.push({ label: "Home", path: home });
  return out;
}

/**
 * List the directories inside `dir`, with a log count for each.
 *
 * `start` is where the picker opens when the UI asks for no particular directory — the folder
 * already in use, so the common case is "confirm what is selected" rather than "navigate from /".
 */
export function browseDir(dir: string | null, start: string | null = null): BrowseResult {
  const target = path.resolve(dir || start || candidateLogDirs()[0] || os.homedir());
  const parentOf = (d: string): string | null => {
    const up = path.dirname(d);
    return up === d ? null : up; // a root is its own parent
  };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    return {
      path: target,
      parent: parentOf(target),
      dirs: [],
      logs: 0,
      shortcuts: shortcuts(),
      error: (err as NodeJS.ErrnoException).code === "EACCES" ? "Permission denied" : "Cannot open folder",
    };
  }

  let logs = 0;
  const names: string[] = [];
  for (const e of entries) {
    // `isDirectory()` is false for a symlinked directory, which is how a Wine bottle is often
    // laid out — so those are followed with a stat rather than skipped.
    if (e.isDirectory()) names.push(e.name);
    else if (e.isSymbolicLink()) {
      try {
        if (fs.statSync(path.join(target, e.name)).isDirectory()) names.push(e.name);
      } catch {
        /* dangling link */
      }
    } else if (isLog(e.name)) logs++;
  }

  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const dirs: BrowseEntry[] = names.map((name, i) => ({
    name,
    logs: i < SCAN_LIMIT ? countLogs(path.join(target, name)) : null,
  }));

  return { path: target, parent: parentOf(target), dirs, logs, shortcuts: shortcuts() };
}
