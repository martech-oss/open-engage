import * as z from "zod";

import { automationGenerationCatalogSchema } from "../automations/generation.js";
import {
  generateMarketingBriefInputSchema,
  marketingCapabilitySnapshotSchema,
  type GenerateMarketingBriefInput,
  type MarketingBriefGenerationResult,
} from "../projects/schema.js";
import { segmentGenerationCatalogSchema } from "../segments/generation.js";

/**
 * Cross-domain trusted context for the Marketing Automation Designer.
 * This belongs to the agent integration layer so the projects domain remains
 * independent from Segment and Automation catalog representations.
 */
export const marketingBriefDesignerInitialDataSchema = z
  .object({
    request: generateMarketingBriefInputSchema,
    now: z.iso.datetime(),
    catalog: automationGenerationCatalogSchema,
    segmentCatalog: segmentGenerationCatalogSchema,
    capabilities: marketingCapabilitySnapshotSchema,
  })
  .strict();
export type MarketingBriefDesignerInitialData = z.infer<
  typeof marketingBriefDesignerInitialDataSchema
>;

/**
 * Deterministic provenance checks shared by the Agent retry loop and Server.
 * Unknown events are allowed only when the proposal explicitly reports them
 * as a capability gap. A measured baseline may only be preserved from the
 * trusted current brief; generation has no measurement source of its own.
 */
export function validateMarketingBriefGenerationResult(
  result: MarketingBriefGenerationResult,
  request: GenerateMarketingBriefInput,
  evidenceCatalog: {
    events: readonly { id: string; name: string; value: string }[];
    customFields: readonly { id: string; name: string; value: string }[];
  },
): string[] {
  const issues: string[] = [];
  const baseline = result.proposal.definition.measurement.baseline;
  if (baseline.kind === "measured") {
    const current =
      request.mode === "refine" ? request.current.definition.measurement.baseline : null;
    if (
      current?.kind !== "measured" ||
      current.value !== baseline.value ||
      current.source !== baseline.source
    ) {
      issues.push(
        "A measured baseline must come unchanged from the current trusted brief; use an assumption or discovery task for generated values",
      );
    }
  }

  for (const event of result.proposal.definition.requiredEvents) {
    if (
      !isExactKnownReference(event, evidenceCatalog.events) &&
      !isReportedGap(event, result.capabilityGaps)
    ) {
      issues.push(`Unknown required event must be reported as a capability gap: ${event}`);
    }
  }
  const evidenceOptions = [...evidenceCatalog.events, ...evidenceCatalog.customFields];
  for (const proof of [
    result.proposal.definition.measurement.outcomeMetric.proof,
    result.proposal.definition.measurement.earlySignal.proof,
  ]) {
    if (
      !mentionsKnownReference(proof, evidenceOptions) &&
      !isReportedGap(proof, result.capabilityGaps)
    ) {
      issues.push(`Unknown metric proof must be reported as a capability gap: ${proof}`);
    }
  }
  return issues;
}

function isExactKnownReference(
  reference: string,
  catalog: readonly { id: string; name: string; value: string }[],
): boolean {
  const normalizedReference = normalize(reference);
  return catalog.some((option) =>
    [option.id, option.name, option.value].some(
      (candidate) => normalize(candidate) === normalizedReference,
    ),
  );
}

function mentionsKnownReference(
  proof: string,
  catalog: readonly { id: string; name: string; value: string }[],
): boolean {
  const normalizedProof = normalize(proof);
  return catalog.some((option) =>
    [option.id, option.name, option.value].some((candidate) => {
      const normalizedCandidate = normalize(candidate);
      return normalizedCandidate.length > 0 && normalizedProof.includes(normalizedCandidate);
    }),
  );
}

function isReportedGap(
  reference: string,
  gaps: readonly { capability: string; detail: string }[],
): boolean {
  const normalizedReference = normalize(reference);
  return gaps.some((gap) => {
    const capability = normalize(gap.capability);
    const detail = normalize(gap.detail);
    return (
      detail.includes(normalizedReference) ||
      (capability.length > 0 &&
        (normalizedReference.includes(capability) || capability.includes(normalizedReference)))
    );
  });
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
