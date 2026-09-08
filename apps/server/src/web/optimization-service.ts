import { chooseExperimentVariant } from "@openengage/core/web";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { OptimizationRepository, type ExposureIdentity } from "@openengage/database/web";

import { sha256Hex } from "../platform/crypto";

export async function selectLandingOptimization(
  database: OpenEngageDatabase,
  input: {
    workspaceId: string;
    pageId: string;
    defaultVersionId: string;
    visitorId: string;
    contactId: string | null;
  },
) {
  const repository = new OptimizationRepository(database, input);
  const experiment = (await repository.experiments(input.pageId)).find(
    (item) => item.status === "running",
  );
  let selected: {
    pageVersionId: string;
    experimentId?: string;
    variantId?: string;
    exposureId?: string;
  } = { pageVersionId: input.defaultVersionId };
  if (experiment) {
    const hash = await sha256Hex(`${input.workspaceId}:${experiment.id}:${input.visitorId}`);
    const variant = chooseExperimentVariant(
      experiment.variants,
      (Number.parseInt(hash.slice(0, 8), 16) / 0x100000000) * 100,
    );
    const assignment = await repository.assign({
      experimentId: experiment.id,
      visitorId: input.visitorId,
      variantId: variant.id,
      pageVersionId: variant.pageVersionId,
    });
    if (assignment)
      selected = {
        pageVersionId: assignment.pageVersionId,
        experimentId: experiment.id,
        variantId: assignment.variantId,
        exposureId: assignment.id,
      };
  }
  const contents = await repository.dynamic(input.pageId);
  const matches = input.contactId
    ? await repository.matchesSegments(
        input.contactId,
        contents.flatMap((content) => content.rules.map((rule) => rule.segmentId)),
      )
    : new Set<string>();
  const dynamicContents = Object.fromEntries(
    contents.map((content) => [
      content.slotId,
      [...content.rules]
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
        .find((rule) => matches.has(rule.segmentId))?.html ?? content.fallbackHtml,
    ]),
  );
  return { ...selected, dynamicContents };
}
export async function recordLandingExperimentExposure(
  database: OpenEngageDatabase,
  input: ExposureIdentity & { workspaceId: string },
  occurredAt: string,
) {
  await new OptimizationRepository(database, input).expose(input, occurredAt);
}
export async function recordLandingExperimentConversion(
  database: OpenEngageDatabase,
  input: ExposureIdentity & { workspaceId: string },
  occurredAt: string,
) {
  await new OptimizationRepository(database, input).convert(input, occurredAt);
}
