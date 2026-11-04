import { describe, it, expect } from "vitest";
import {
  eligibleForReel,
  planReel,
  portraitFrame,
  reelFileName,
  reelStoragePath,
  ReelPlanError,
  REEL_FPS,
  type ReelSourceCreative,
} from "./reel-plan";

function post(id: string, over: Partial<ReelSourceCreative> & { portrait?: boolean; state?: string } = {}): ReelSourceCreative {
  const { portrait = true, state = "approved", ...rest } = over;
  return {
    id,
    title: `Post ${id}`,
    slot_date: `2026-11-${id.padStart(2, "0")}`,
    latest: {
      state,
      renders: [
        { aspect: "1:1", slide: null, public_url: `https://x/${id}-1x1.png` },
        ...(portrait ? [{ aspect: "9:16", slide: null, public_url: `https://x/${id}-9x16.png` }] : []),
      ],
      inputs: { headline: `Headline ${id}`, colors: { primary: "#123456", text: "#ffffff", background: "#000000" } },
    },
    ...rest,
  };
}

describe("eligibleForReel", () => {
  it("keeps approved posts with a 9:16 frame, oldest first", () => {
    const list = [post("3"), post("1"), post("2", { portrait: false }), post("4", { state: "draft" })];
    expect(eligibleForReel(list).map((c) => c.id)).toEqual(["1", "3"]);
    expect(eligibleForReel(list, false).map((c) => c.id)).toEqual(["1", "3", "4"]);
  });
  it("uses slide 1 of a carousel", () => {
    const c = post("9");
    c.latest!.renders = [{ aspect: "9:16", slide: 2, public_url: "s2" }, { aspect: "9:16", slide: 1, public_url: "s1" }];
    expect(portraitFrame(c)).toBe("s1");
  });
});

describe("planReel", () => {
  const posts = [post("1"), post("2"), post("3")];

  it("builds slides in the requested order with the brand colours of the first post", () => {
    const plan = planReel(posts, ["2", "1"], {});
    expect(plan.props.slides.map((s) => s.creative_id)).toEqual(["2", "1"]);
    expect(plan.props.slides[0]).toMatchObject({ src: "https://x/2-9x16.png", headline: "Headline 2" });
    expect(plan.props.brand).toEqual({ primary: "#123456", text: "#ffffff", background: "#000000", logo_url: null });
    expect(plan.fps).toBe(REEL_FPS);
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
  });

  it("computes the duration: slides overlap by one fade, plus intro and final fade", () => {
    const plan = planReel(posts, ["1", "2", "3"], { slide_sec: 3, fade_sec: 0.5 });
    // 3 slides * 90 - 2 * 15 + 15 = 255 frames = 8.5 s
    expect(plan.props).toMatchObject({ slideFrames: 90, fadeFrames: 15, introFrames: 0 });
    expect(plan.durationInFrames).toBe(255);
    expect(plan.durationSec).toBe(8.5);
    const withTitle = planReel(posts, ["1", "2"], { slide_sec: 3, fade_sec: 0.5, title: "  Deckor " });
    expect(withTitle.props.title).toBe("Deckor");
    expect(withTitle.props.introFrames).toBe(60);
    expect(withTitle.durationInFrames).toBe(60 + 180 - 15 + 15);
  });

  it("clamps silly settings", () => {
    const plan = planReel(posts, ["1", "2"], { slide_sec: 0.2, fade_sec: 9 });
    expect(plan.props.slideFrames).toBe(45); // 1.5 s floor
    expect(plan.props.fadeFrames).toBe(Math.round(0.75 * REEL_FPS)); // half a slide at most
  });

  it("refuses too few, too many, or posts without a 9:16 frame", () => {
    expect(() => planReel(posts, ["1"], {})).toThrow(ReelPlanError);
    expect(() => planReel(posts, ["1", "missing"], {})).toThrow(/no 9:16 render/);
    const many = Array.from({ length: 13 }, (_, i) => post(String(i + 1)));
    expect(() => planReel(many, many.map((p) => p.id), {})).toThrow(/at most 12/);
  });
});

describe("names", () => {
  it("file and storage names", () => {
    expect(reelFileName("2026-11-01", 5)).toBe("2026-11_reel_5-posts.mp4");
    expect(reelStoragePath("c1", "r1")).toBe("c1/reels/r1.mp4");
  });
});
