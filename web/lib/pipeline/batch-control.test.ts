/**
 * batch-control.test.ts — which Pause / Resume / Cancel applies to which batch status, and a run's end state.
 *
 * Inputs:  batch statuses and stop kinds
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("../db", () => ({ getDb: () => ({}) }));

import { BatchControlError, controlPatch } from "./batch-control";
import { finalState } from "./orchestrator";

describe("controlPatch", () => {
  it("pauses a queued batch at once and asks a running one to pause", () => {
    expect(controlPatch("queued", "pause")).toEqual({ patch: { status: "paused" }, run: false });
    expect(controlPatch("running", "pause")).toEqual({ patch: { stop_requested: "pause" }, run: false });
  });

  it("cancels queued/paused at once and asks a running one to cancel", () => {
    const now = { patch: { status: "cancelled", stop_requested: null, resume_from: null }, run: false };
    expect(controlPatch("queued", "cancel")).toEqual(now);
    expect(controlPatch("paused", "cancel")).toEqual(now);
    expect(controlPatch("running", "cancel")).toEqual({ patch: { stop_requested: "cancel" }, run: false });
  });

  it("resumes only a paused batch, and the caller then starts the run", () => {
    expect(controlPatch("paused", "resume")).toEqual({ patch: { status: "queued" }, run: true });
    expect(() => controlPatch("running", "resume")).toThrow(BatchControlError);
  });

  it("refuses actions on finished batches", () => {
    for (const s of ["done", "failed", "cancelled"]) {
      expect(() => controlPatch(s, "pause")).toThrow(BatchControlError);
      expect(() => controlPatch(s, "cancel")).toThrow(BatchControlError);
    }
  });
});

describe("finalState", () => {
  it("maps a run's stop to the batch status and resume point", () => {
    expect(finalState(null)).toEqual({ status: "done", resume_from: null });
    expect(finalState("pause")).toEqual({ status: "paused", resume_from: "enrich" });
    expect(finalState("cancel")).toEqual({ status: "cancelled", resume_from: null });
  });
});
