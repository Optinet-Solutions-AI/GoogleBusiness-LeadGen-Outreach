/**
 * sequence-scheduler.test.ts — lock the follow-up safety rules:
 *  - we only ADVANCE the ladder when an email actually went out
 *  - a held send (pause/cap) DEFERS (no advance)
 *  - a real send failure FAILS (caller stops the ladder — never follow up)
 *  - advanceState schedules +4 days, and completes after step 4
 */

import { describe, it, expect } from "vitest";
import { classifySendOutcome, advanceState } from "./sequence-scheduler";

describe("classifySendOutcome — never advance on a non-send", () => {
  it("advances on a real send", () => {
    expect(classifySendOutcome({ sent: true, noop: false })).toBe("advance");
  });

  it("advances on a $0 soft no-op (no mailbox connected, dev/test)", () => {
    expect(classifySendOutcome({ sent: true, noop: true })).toBe("advance");
    expect(classifySendOutcome({ sent: false, noop: true })).toBe("advance");
  });

  it("DEFERS (no advance) when paused or capped", () => {
    expect(classifySendOutcome({ sent: false, reason: "paused" })).toBe("defer");
    expect(classifySendOutcome({ sent: false, reason: "capped" })).toBe("defer");
  });

  it("FAILS (stop, never follow up) on a real send failure", () => {
    expect(classifySendOutcome({ sent: false, error: "550 rejected" } as never)).toBe("fail");
    expect(classifySendOutcome({ sent: false })).toBe("fail");
  });
});

describe("advanceState", () => {
  it("keeps the ladder active and schedules the next step ~4 days out for steps 1-3", () => {
    for (const step of [1, 2, 3] as const) {
      const p = advanceState(step);
      expect(p.seq_step).toBe(step);
      expect(p.seq_status).toBeUndefined(); // stays 'active'
      expect(typeof p.seq_next_step_at).toBe("string");
      expect(new Date(p.seq_next_step_at as string).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("completes after step 4 with no next step", () => {
    const p = advanceState(4);
    expect(p.seq_step).toBe(4);
    expect(p.seq_status).toBe("completed");
    expect(p.seq_next_step_at).toBeNull();
  });
});
