import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/services/openai-brain", () => ({ readBriefFile: vi.fn(), BrainError: class extends Error {} }));

import { readUploads } from "./read-files";

const file = (name: string, text: string, type = "text/plain") => ({ name, type, data: Buffer.from(text, "utf8") });

describe("readUploads", () => {
  it("a CSV list and a text brief", async () => {
    const r = await readUploads([file("dentists.csv", "Business,Email\nSmile Co,hi@smile.com\n"), file("notes.txt", "Pitch the AI receptionist.")]);
    if ("refused" in r) throw new Error(r.refused);
    expect(r.list?.name).toBe("dentists.csv");
    expect(r.list?.rows.map((x) => x.business_name)).toEqual(["Smile Co"]);
    expect(r.briefs).toEqual([{ name: "notes.txt", text: "Pitch the AI receptionist." }]);
    expect(r.usd).toBe(0);
  });

  it("a PDF brief that can't be read is noted; the list is still read", async () => {
    const readBrief = vi.fn(async () => {
      throw new Error("openai down");
    });
    const r = await readUploads([file("list.csv", "name\nA\n"), { name: "offer.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4") }], { readBrief });
    if ("refused" in r) throw new Error(r.refused);
    expect(r.list?.rows).toHaveLength(1);
    expect(r.briefs).toEqual([{ name: "offer.pdf", text: null, note: "couldn't read it" }]);
  });

  it("a PDF brief read by OpenAI counts its cost", async () => {
    const readBrief = vi.fn(async () => ({ text: "Offer: AI receptionist at $99/month.", usd: 0.01 }));
    const r = await readUploads([{ name: "offer.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4") }], { readBrief });
    if ("refused" in r) throw new Error(r.refused);
    expect(r.briefs[0]).toEqual({ name: "offer.pdf", text: "Offer: AI receptionist at $99/month." });
    expect(r.usd).toBe(0.01);
    expect(r.list).toBeNull();
  });

  it("a list without a business name column is refused", async () => {
    expect(await readUploads([file("x.csv", "website,email\nx.com,a@x.com\n")])).toEqual({ refused: "x.csv: I need a column with the business name" });
  });
});

describe("review I5: briefs read together, under one deadline", () => {
  const pdf = (name: string) => ({ name, type: "application/pdf", data: Buffer.from("%PDF-1.4") });
  it("two PDFs are read at the same time, in file order", async () => {
    let running = 0;
    let most = 0;
    const readBrief = vi.fn(async ({ name }: { name: string }) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return { text: `text of ${name}`, usd: 0.01 };
    });
    const r = await readUploads([pdf("a.pdf"), pdf("b.pdf")], { readBrief });
    if ("refused" in r) throw new Error(r.refused);
    expect(most).toBe(2);
    expect(r.briefs.map((b) => b.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(r.usd).toBe(0.02);
  });
  it("a read past the deadline is skipped with a note; the job goes on", async () => {
    const readBrief = vi.fn(() => new Promise<{ text: string; usd: number }>(() => {}));
    const r = await readUploads([pdf("slow.pdf")], { readBrief, deadlineMs: 30 });
    if ("refused" in r) throw new Error(r.refused);
    expect(r.briefs).toEqual([{ name: "slow.pdf", text: null, note: "it took too long to read" }]);
  });
});
