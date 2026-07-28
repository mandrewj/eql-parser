// Combat engine: consumes CombatEvents, tracks the entity roster, the stance
// timeline, fight segmentation, and per-combatant aggregation. Filled in M2.

import type { CombatEvent, Fight, FightSummary, StanceSegment } from "../types.js";

export interface EngineOptions {
  selfName: string; // resolved from the log filename; "You" maps to this
  inactivityTimeoutSec: number;
}

export class Engine {
  private readonly opts: EngineOptions;
  private currentStance = "unknown";
  private stanceTimeline: StanceSegment[] = [];
  private fights: Fight[] = [];

  constructor(opts: EngineOptions) {
    this.opts = opts;
  }

  /** Feed one parsed event into the engine. */
  handle(_event: CombatEvent): void {
    // TODO(M2): entity classification, stance timeline, fight open/close, aggregation.
  }

  get stance(): string {
    return this.currentStance;
  }

  /** Current fight (if any) plus recent fight summaries — sent to the UI. */
  snapshot(): { current: Fight | null; recent: FightSummary[]; stance: string } {
    return { current: null, recent: [], stance: this.currentStance };
  }
}
