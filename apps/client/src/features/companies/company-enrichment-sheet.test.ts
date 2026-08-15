import { describe, expect, it } from "vitest";

import type { CompanyEnrichmentProposal } from "@openengage/core/contacts";

import {
  defaultCompanyEnrichmentApplySelection,
  selectedCompanyEnrichmentValues,
} from "./company-enrichment-sheet";

const proposal: CompanyEnrichmentProposal = {
  fields: {
    officialName: { value: "Example Inc.", confidence: "high", sourceIds: ["official"] },
    domain: { value: "example.com", confidence: "high", sourceIds: ["official"] },
    description: { value: "A company", confidence: "high", sourceIds: ["official"] },
  },
  sources: [
    {
      id: "official",
      url: "https://example.com/",
      title: "Example",
      kind: "official",
      retrievedAt: "2026-08-16T00:00:00.000Z",
    },
  ],
  warnings: [],
};

describe("company enrichment apply selection", () => {
  it("does not select replacements for existing different values", () => {
    expect(defaultCompanyEnrichmentApplySelection("User Name", "user.example", proposal)).toEqual({
      name: false,
      domain: false,
    });
  });

  it("selects missing values by default", () => {
    expect(defaultCompanyEnrichmentApplySelection("", "", proposal)).toEqual({
      name: true,
      domain: true,
    });
  });

  it("returns only explicitly selected supported fields", () => {
    expect(selectedCompanyEnrichmentValues(proposal, { name: false, domain: true })).toEqual({
      domain: "example.com",
    });
  });
});
