import { describe, expect, it } from "vitest";
import { estimateCostUsd, stripDisclaimers } from "../src/claude";

describe("stripDisclaimers", () => {
  it("removes sentences about missing or unreadable text", () => {
    expect(stripDisclaimers("Modal raised $750 million at a $15.75 billion valuation. The article text was mostly page navigation, so no further details are available."))
      .toBe("Modal raised $750 million at a $15.75 billion valuation.");
    expect(stripDisclaimers("Applied Intuition has received offers at $30 billion. The available text was paywalled, so no further details are known."))
      .toBe("Applied Intuition has received offers at $30 billion.");
    expect(stripDisclaimers("Meta unveiled new models. Specific model details are not available.")).toBe("Meta unveiled new models.");
    expect(stripDisclaimers("Meta unveiled new models. The source gave no further specifics on pricing.")).toBe("Meta unveiled new models.");
    expect(stripDisclaimers("Details beyond the headline are not available.")).toBe("");
    expect(stripDisclaimers("A new Meta model arrives. Pricing and access details were not in the available text.")).toBe("A new Meta model arrives.");
    expect(stripDisclaimers("California leads on AI rules. The available text contains no specific rules or figures.")).toBe("California leads on AI rules.");
  });
  it("keeps normal sentences, including ones that mention navigation or details", () => {
    const text = "An autonomous navigation startup raised $50 million. The deal details were announced on Monday.";
    expect(stripDisclaimers(text)).toBe(text);
  });
});

describe("estimateCostUsd", () => {
  it("uses Haiku 5.5 list prices", () => {
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBeCloseTo(0.6, 5);
  });
});
