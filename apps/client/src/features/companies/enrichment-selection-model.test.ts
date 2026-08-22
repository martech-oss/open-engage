import { describe, expect, it } from "vitest";

import type { CompanyEnrichmentProposal } from "@openengage/core/contacts";

import {
  defaultCompanyEnrichmentApplySelection,
  selectedCompanyEnrichmentValues,
} from "./enrichment-selection-model";

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

describe("company enrichment selection model", () => {
  it("selects only missing current values by default", () => {
    expect(defaultCompanyEnrichmentApplySelection("Existing", "", proposal)).toEqual({
      name: false,
      domain: true,
    });
  });

  it("does not emit unavailable or unselected fields", () => {
    expect(
      selectedCompanyEnrichmentValues(
        { ...proposal, fields: { ...proposal.fields, officialName: undefined } },
        { name: true, domain: false },
      ),
    ).toEqual({});
  });
});
