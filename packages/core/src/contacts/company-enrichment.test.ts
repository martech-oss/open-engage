import { describe, expect, it } from "vitest";

import {
  companyEnrichmentResultSchema,
  validateCompanyEnrichmentResult,
  type CompanyEnrichmentResult,
} from "./company-enrichment";

const source = {
  id: "official-home",
  url: "https://example.com/",
  title: "Example Inc.",
  kind: "official" as const,
  retrievedAt: "2026-08-16T00:00:00.000Z",
};

function readyResult(): CompanyEnrichmentResult {
  return {
    status: "ready",
    proposal: {
      fields: {
        officialName: { value: "Example Inc.", confidence: "high", sourceIds: [source.id] },
        domain: { value: "example.com", confidence: "high", sourceIds: [source.id] },
      },
      sources: [source],
      warnings: [],
    },
  };
}

describe("companyEnrichmentResultSchema", () => {
  it("accepts a source-backed ready proposal", () => {
    expect(companyEnrichmentResultSchema.safeParse(readyResult()).success).toBe(true);
    expect(validateCompanyEnrichmentResult(readyResult())).toBeNull();
  });

  it("rejects fields that reference an unknown source", () => {
    const result = readyResult();
    if (result.status !== "ready" || !result.proposal.fields.domain) throw new Error("fixture");
    result.proposal.fields.domain.sourceIds = ["missing"];
    expect(validateCompanyEnrichmentResult(result)).toBe("Unknown enrichment source id: missing");
  });

  it("rejects duplicate source ids", () => {
    const result = readyResult();
    if (result.status !== "ready") throw new Error("fixture");
    result.proposal.sources.push({ ...source, url: "https://example.com/about" });
    expect(validateCompanyEnrichmentResult(result)).toBe(
      "Duplicate enrichment source id: official-home",
    );
  });

  it("rejects private source URLs", () => {
    const result = readyResult();
    if (result.status !== "ready") throw new Error("fixture");
    result.proposal.sources[0] = { ...source, url: "https://127.0.0.1/company" };
    expect(validateCompanyEnrichmentResult(result)).toBe(
      "Source URL must be public HTTPS: https://127.0.0.1/company",
    );
  });

  it("requires candidate URLs to match their selected domain", () => {
    const result: CompanyEnrichmentResult = {
      status: "needs_domain",
      reason: "Confirmation required",
      candidates: [
        {
          name: "Example",
          domain: "example.com",
          url: "https://other.example/",
          reason: "Ambiguous",
          sourceIds: ["search-1"],
        },
      ],
      sources: [
        {
          id: "search-1",
          url: "https://search.example/result",
          title: "Search result",
          kind: "search",
          retrievedAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    };
    expect(validateCompanyEnrichmentResult(result)).toContain("Candidate URL must be HTTPS");
  });
});
