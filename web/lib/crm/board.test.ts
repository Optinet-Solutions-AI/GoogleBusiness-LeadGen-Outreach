import { describe, it, expect } from "vitest";
import {
  CRM_COLUMNS,
  columnForStage,
  countFollowUps,
  filterCards,
  followUpBucket,
  groupIntoColumns,
  normaliseTags,
  NEW_COLUMN_CAP,
  type CrmCard,
} from "./board";

const NOW = new Date(2026, 10, 4, 10, 0, 0); // 4 Nov 2026 10:00 local

function card(over: Partial<CrmCard> = {}): CrmCard {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    business_name: "Acme",
    stage: "replied",
    phone: null,
    email: null,
    address: "1 Main St, Valletta, Malta",
    country_code: "mt",
    category: "flooring",
    primary_offer: "build_website",
    demo_url: null,
    screenshot_url: null,
    tags: [],
    next_follow_up_at: null,
    assigned_to: null,
    updated_at: "2026-11-01T00:00:00Z",
    inbox_status: null,
    seq_status: null,
    call_status: null,
    setup_fee: null,
    monthly_amount: null,
    ...over,
  };
}

describe("columns", () => {
  it("every lifecycle stage lands in exactly one column", () => {
    const stages = ["scraped", "enriched", "generated", "deployed", "needs_email", "outreached", "replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won", "closed_lost", "dead"];
    for (const s of stages) {
      const owners = CRM_COLUMNS.filter((c) => c.stages.includes(s));
      expect(owners, s).toHaveLength(1);
    }
    expect(columnForStage("dead").key).toBe("lost");
    expect(columnForStage("??").key).toBe("new");
  });

  it("only the Not-contacted column refuses drops", () => {
    expect(CRM_COLUMNS.filter((c) => c.dropStage === null).map((c) => c.key)).toEqual(["new"]);
    expect(columnForStage("dead").dropStage).toBe("closed_lost");
  });

  it("caps the Not-contacted column but keeps the true total and sums won MRR", () => {
    const cards = [
      ...Array.from({ length: NEW_COLUMN_CAP + 5 }, (_, i) => card({ id: `n${i}`, stage: "enriched" })),
      card({ id: "w1", stage: "closed_won", monthly_amount: 99 }),
      card({ id: "w2", stage: "closed_won", monthly_amount: 49 }),
    ];
    const cols = groupIntoColumns(cards);
    const fresh = cols.find((c) => c.column.key === "new")!;
    expect(fresh.cards).toHaveLength(NEW_COLUMN_CAP);
    expect(fresh.total).toBe(NEW_COLUMN_CAP + 5);
    expect(cols.find((c) => c.column.key === "closed_won")!.mrr).toBe(148);
  });
});

describe("follow-ups", () => {
  it("buckets by the operator's local day", () => {
    expect(followUpBucket(null, NOW)).toBe("none");
    expect(followUpBucket("garbage", NOW)).toBe("none");
    expect(followUpBucket(new Date(2026, 10, 3, 23, 59).toISOString(), NOW)).toBe("overdue");
    expect(followUpBucket(new Date(2026, 10, 4, 0, 1).toISOString(), NOW)).toBe("today");
    expect(followUpBucket(new Date(2026, 10, 4, 23, 0).toISOString(), NOW)).toBe("today");
    expect(followUpBucket(new Date(2026, 10, 7).toISOString(), NOW)).toBe("week");
    expect(followUpBucket(new Date(2026, 10, 20).toISOString(), NOW)).toBe("later");
  });

  it("counts overdue / today / week", () => {
    const cards = [
      card({ next_follow_up_at: new Date(2026, 10, 1).toISOString() }),
      card({ next_follow_up_at: new Date(2026, 10, 4, 15).toISOString() }),
      card({ next_follow_up_at: new Date(2026, 10, 6).toISOString() }),
      card({ next_follow_up_at: new Date(2026, 11, 6).toISOString() }),
      card(),
    ];
    expect(countFollowUps(cards, NOW)).toEqual({ overdue: 1, today: 1, week: 1 });
  });
});

describe("filters", () => {
  const cards = [
    card({ id: "a", business_name: "Deckor", email: "info@deckor.com.mt", tags: ["hot"], assigned_to: "Meny", next_follow_up_at: new Date(2026, 10, 1).toISOString() }),
    card({ id: "b", business_name: "Beta Centre", phone: "+356 2100", country_code: "es", primary_offer: "improve_website" }),
  ];
  it("searches name / email / phone / address, case-insensitively", () => {
    expect(filterCards(cards, { q: "DECK" }, NOW).map((c) => c.id)).toEqual(["a"]);
    expect(filterCards(cards, { q: "2100" }, NOW).map((c) => c.id)).toEqual(["b"]);
    expect(filterCards(cards, { q: "valletta" }, NOW)).toHaveLength(2);
  });
  it("matches tag, owner, offer, country and due", () => {
    expect(filterCards(cards, { tag: "HOT" }, NOW).map((c) => c.id)).toEqual(["a"]);
    expect(filterCards(cards, { owner: "meny" }, NOW).map((c) => c.id)).toEqual(["a"]);
    expect(filterCards(cards, { offer: "improve_website" }, NOW).map((c) => c.id)).toEqual(["b"]);
    expect(filterCards(cards, { country: "ES" }, NOW).map((c) => c.id)).toEqual(["b"]);
    expect(filterCards(cards, { due: "overdue" }, NOW).map((c) => c.id)).toEqual(["a"]);
    expect(filterCards(cards, { due: "any" }, NOW).map((c) => c.id)).toEqual(["a"]);
    expect(filterCards(cards, { due: "today" }, NOW)).toHaveLength(0);
  });
});

describe("normaliseTags", () => {
  it("lower-cases, dashes spaces, dedupes and caps at 10", () => {
    expect(normaliseTags([" Hot ", "hot", "Price Sensitive", ""])).toEqual(["hot", "price-sensitive"]);
    expect(normaliseTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
});
