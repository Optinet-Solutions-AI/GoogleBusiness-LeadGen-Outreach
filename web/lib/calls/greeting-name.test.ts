/**
 * greeting-name.test.ts — the name the AI agent greets a lead by.
 *
 * Inputs:  owner names and typed names
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { cleanGreetingName, suggestGreetingName } from "./greeting-name";

describe("suggestGreetingName", () => {
  it("takes the first real first name", () => {
    expect(suggestGreetingName("Robert Ellul")).toBe("Robert");
    expect(suggestGreetingName("Dr. Jane Smith")).toBe("Jane");
    expect(suggestGreetingName("MR JOHN DOE")).toBe("John");
    expect(suggestGreetingName("José García")).toBe("José");
  });
  it("never offers a role or mailbox word as a name", () => {
    expect(suggestGreetingName("Owner")).toBeNull();
    expect(suggestGreetingName("The Team")).toBeNull();
    expect(suggestGreetingName("info")).toBeNull();
    expect(suggestGreetingName(null)).toBeNull();
  });
});

describe("cleanGreetingName", () => {
  it("keeps letters, spaces, apostrophes and hyphens; empty means no name", () => {
    expect(cleanGreetingName("  Mary-Jane ")).toBe("Mary-Jane");
    expect(cleanGreetingName("O'Brien <script>")).toBe("O'Brien script");
    expect(cleanGreetingName("")).toBeNull();
    expect(cleanGreetingName("1")).toBeNull();
  });
});
