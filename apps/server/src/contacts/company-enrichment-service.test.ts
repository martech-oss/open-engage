import { describe, expect, it } from "vitest";

import type { RuntimeEnv } from "../env";
import {
  CompanyEnrichmentError,
  enrichCompany,
  isCompanyEnrichmentEnabled,
} from "./company-enrichment-service";

describe("company enrichment capability", () => {
  it.each([
    ["true", true],
    [" TRUE ", true],
    ["false", false],
    ["", false],
  ])("parses %j as %j", (value, expected) => {
    expect(isCompanyEnrichmentEnabled({ COMPANY_ENRICHMENT_ENABLED: value })).toBe(expected);
  });

  it("rejects enrichment before invoking the Agent when disabled", async () => {
    const env = { COMPANY_ENRICHMENT_ENABLED: "false" } as RuntimeEnv;
    await expect(
      enrichCompany(env, { source: "domain", domain: "example.com" }),
    ).rejects.toMatchObject({ kind: "unavailable" } satisfies Partial<CompanyEnrichmentError>);
  });
});
