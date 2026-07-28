// Line parser: raw log line → CombatEvent. Filled in during M1.
//
// Fast path: only lines containing one of these keywords can be combat-relevant,
// so we prefilter before running the (heavier) regexes.

import type { CombatEvent } from "../types.js";

export const RELEVANT_KEYWORDS = ["damage", "slain", "but miss", "assume"] as const;

const TIMESTAMP_RE = /^\[([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.*)$/;

/** Split a raw line into its timestamp (ms) and body, or null if not a log line. */
export function splitLine(raw: string): { tsMs: number; body: string } | null {
  const m = TIMESTAMP_RE.exec(raw.replace(/\r$/, ""));
  if (!m) return null;
  const tsMs = Date.parse(m[1]!.replace(/ +/g, " ")); // collapse space-padded day
  if (Number.isNaN(tsMs)) return null;
  return { tsMs, body: m[2]! };
}

/** Parse one raw log line into a CombatEvent, or null if not relevant. */
export function parseLine(_raw: string): CombatEvent | null {
  // TODO(M1): implement melee / spell / dot / miss / death / stance grammar.
  return null;
}
