import { describe, expect, it } from "vitest";
import { buildOutreachMarks, emailMarkLabel, formMarkLabel, shortDay, type MarkRun } from "./outreach-marks";
import type { RunStatus } from "@/lib/contact-form/rules";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const run = (lead_id: string, status: RunStatus, minsAgo: number, extra: Partial<MarkRun> = {}): MarkRun => {
  const t = new Date(NOW - minsAgo * 60_000).toISOString();
  return { lead_id, status, created_at: t, updated_at: t, sent_at: null, message: "Hello", ...extra };
};

describe("buildOutreachMarks", () => {
  it("counts the emails we sent each lead and keeps the latest date", () => {
    const m = buildOutreachMarks(
      [
        { lead_id: "A", created_at: "2026-11-20T09:00:00Z" },
        { lead_id: "A", created_at: "2026-11-24T09:00:00Z" },
        { lead_id: "B", created_at: "2026-11-25T09:00:00Z" },
      ],
      [],
      NOW,
    );
    expect(m.get("A")).toMatchObject({ emails: 2, lastEmailAt: "2026-11-24T09:00:00Z", form: null });
    expect(m.get("B")).toMatchObject({ emails: 1 });
    expect(m.get("C")).toBeUndefined();
  });

  it("shows the newest contact form attempt, with stuck ones read honestly", () => {
    const m = buildOutreachMarks(
      [],
      [
        run("A", "sent", 300, { sent_at: "2026-11-26T07:00:00Z" }),
        run("A", "sending", 2), // newest wins
        run("B", "sending", 30), // stuck 10+ min: may have gone out
        run("C", "looking", 1),
      ],
      NOW,
    );
    expect(m.get("A")?.form?.status).toBe("sending");
    expect(m.get("B")?.form?.status).toBe("unknown");
    expect(m.get("C")?.form?.status).toBe("looking");
  });

  it("a look that was never sent from (just a screenshot of their form) is not a mark", () => {
    const m = buildOutreachMarks([], [run("A", "ready", 5, { message: null })], NOW);
    expect(m.get("A")).toBeUndefined();
  });
});

describe("labels", () => {
  it("says when a lead was emailed", () => {
    expect(emailMarkLabel({ emails: 1, lastEmailAt: "2026-11-25T09:00:00Z", form: null })).toBe("Emailed 25 Nov");
    expect(emailMarkLabel({ emails: 3, lastEmailAt: "2026-11-25T09:00:00Z", form: null })).toBe("Emailed 3× · last 25 Nov");
    expect(emailMarkLabel({ emails: 0, lastEmailAt: null, form: null })).toBeNull();
  });

  it("says where a contact form stands, in plain words", () => {
    expect(formMarkLabel("looking")).toMatchObject({ label: "Form: opening their page…", active: true });
    expect(formMarkLabel("sending")).toMatchObject({ label: "Form: AI is filling it…", active: true });
    expect(formMarkLabel("sent")).toMatchObject({ label: "Form sent", tone: "positive", active: false });
    expect(formMarkLabel("blocked")).toMatchObject({ label: "Form needs you", tone: "warning" });
    expect(formMarkLabel("unknown")).toMatchObject({ label: "Form: check their page", tone: "warning" });
    expect(formMarkLabel("failed")).toMatchObject({ label: "Form not sent", tone: "urgent" });
    expect(formMarkLabel("cancelled")).toMatchObject({ label: "Form cancelled" });
    expect(formMarkLabel("no_form")).toMatchObject({ label: "No contact form" });
    expect(formMarkLabel("ready")).toBeNull();
  });

  it("writes a short day the same on the server and in the browser", () => {
    expect(shortDay("2026-11-05T23:30:00Z")).toBe("5 Nov");
    expect(shortDay("nonsense")).toBe("");
  });
});
