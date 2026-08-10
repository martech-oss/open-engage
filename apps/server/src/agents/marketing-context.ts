import {
  DEFAULT_MARKETING_CAPABILITY_SNAPSHOT,
  marketingCapabilitySnapshotSchema,
  type ApprovedMarketingBriefContext,
  type MarketingCapabilitySnapshot,
} from "@openengage/core/projects";

/**
 * Single server-side source for product capability state exposed to UI and
 * proposal Agents. Future provider/configuration checks belong here.
 */
export function loadMarketingCapabilitySnapshot(): MarketingCapabilitySnapshot {
  return marketingCapabilitySnapshotSchema.parse(DEFAULT_MARKETING_CAPABILITY_SNAPSHOT);
}

export function loadMarketingAgentContext(trustedBrief?: ApprovedMarketingBriefContext):
  | { capabilities: MarketingCapabilitySnapshot }
  | {
      capabilities: MarketingCapabilitySnapshot;
      trustedBrief: ApprovedMarketingBriefContext;
    } {
  const capabilities = loadMarketingCapabilitySnapshot();
  return trustedBrief ? { capabilities, trustedBrief } : { capabilities };
}
