import { describe, it, expect } from "vitest";
import {
  normalizeToTerms,
  normalizeTextToTerms,
  normalizeQuery,
  termOverlap,
} from "./normalize.js";

describe("normalize", () => {
  it("lowercases, dedupes, and sorts terms", () => {
    expect(normalizeTextToTerms("Network NETWORK firewall")).toEqual([
      "firewall",
      "network",
    ]);
  });

  it("keeps identifiers with internal dots/dashes/underscores", () => {
    const terms = normalizeTextToTerms(
      "Ping 10.0.0.1 on acme-vpn via db_host running v1.2"
    );
    expect(terms).toContain("10.0.0.1");
    expect(terms).toContain("acme-vpn");
    expect(terms).toContain("db_host");
    expect(terms).toContain("v1.2");
  });

  it("drops stopwords and single-character tokens", () => {
    expect(normalizeTextToTerms("the a of firewall x")).toEqual(["firewall"]);
  });

  it("strips HTML from content before tokenizing", () => {
    const terms = normalizeToTerms("<p>Hello <b>Firewall</b></p>");
    expect(terms).toEqual(["firewall", "hello"]);
    expect(terms.join(" ")).not.toContain("<");
  });

  it("returns empty for HTML-only or empty input", () => {
    expect(normalizeToTerms("<p></p>")).toEqual([]);
    expect(normalizeToTerms("")).toEqual([]);
    expect(normalizeTextToTerms("")).toEqual([]);
  });

  it("does not preserve word order (non-reconstructable)", () => {
    // "zebra apple" and "apple zebra" normalize identically.
    expect(normalizeTextToTerms("zebra apple")).toEqual(
      normalizeTextToTerms("apple zebra")
    );
  });

  it("normalizeQuery matches the text pipeline", () => {
    expect(normalizeQuery("VPN Setup")).toEqual(["setup", "vpn"]);
  });

  it("termOverlap returns shared terms", () => {
    expect(termOverlap(["setup", "vpn"], ["network", "vpn"])).toEqual(["vpn"]);
    expect(termOverlap([], ["vpn"])).toEqual([]);
    expect(termOverlap(["a"], [])).toEqual([]);
  });
});
