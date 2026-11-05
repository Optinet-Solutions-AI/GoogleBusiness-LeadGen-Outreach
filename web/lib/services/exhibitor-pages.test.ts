import { describe, it, expect } from "vitest";
import { htmlToText, isBotChallenge } from "./exhibitor-pages";

describe("isBotChallenge", () => {
  it("spots Cloudflare interstitials and captchas", () => {
    expect(isBotChallenge("<html><head><title>Just a moment...</title><script src=\"https://challenges.cloudflare.com/x\"></script>")).toBe(true);
    expect(isBotChallenge("<html><body><h1>Exhibitors</h1><ul><li>Acme</li></ul></body></html>")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("drops chrome, keeps the list and the company links", () => {
    const html = `<html><head><style>.x{}</style><script>var a=1</script></head><body>
      <nav><a href="https://x.com/">Home</a></nav>
      <h1>Exhibitor list</h1>
      <ul><li><a href="https://acme.example">Acme &amp; Sons</a> — Booth A12</li><li>Beta GmbH<br>Stand 3B20</li></ul>
      <footer>© organiser</footer></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("Exhibitor list");
    expect(t).toContain("Acme & Sons (https://acme.example)");
    expect(t).toContain("Booth A12");
    expect(t).toContain("Beta GmbH\nStand 3B20");
    expect(t).not.toContain("Home");
    expect(t).not.toContain("organiser");
    expect(t).not.toContain("var a=1");
  });
  it("caps the length", () => {
    expect(htmlToText("<p>" + "x".repeat(100_000) + "</p>", 500).length).toBe(500);
  });
});
