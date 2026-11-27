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
