import { type OpenEngageDatabase } from "@openengage/database/client";
import { compileWorkspaceSegmentFilter } from "@openengage/database/segments";
import {
  SegmentMaintenanceRepository,
  SegmentEvaluationRepository,
  SegmentQueryRepository,
  SegmentCatalogRepository,
} from "@openengage/database/segments";

export async function updateSegmentMemberCount(
  database: OpenEngageDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<void> {
  await new SegmentEvaluationRepository(database, { workspaceId }).updateMemberCount(segmentId);
}

export async function refreshSegmentMemberships(
  database: OpenEngageDatabase,
  workspaceId: string,
  segmentId: string,
  expectedFilterVersion?: number,
): Promise<boolean> {
  const segmentQuery = new SegmentQueryRepository(database, { workspaceId }),
    segmentEvaluation = new SegmentEvaluationRepository(database, { workspaceId });
  const segment = await segmentQuery.findSegmentDefinition(segmentId);
  if (!segment) return false;
  if (expectedFilterVersion !== undefined && segment.filterVersion !== expectedFilterVersion) {
    return true;
  }
  if (segment.kind === "static") {
    await segmentEvaluation.updateMemberCount(segmentId, {
      kind: "static",
      filterVersion: segment.filterVersion,
    });
    return true;
  }
  if (!segment.filterAst) return false;
  const compiled = compileWorkspaceSegmentFilter(workspaceId, segment.filterAst);
  const definition = { kind: "dynamic" as const, filterVersion: segment.filterVersion };
  await segmentEvaluation.setEvaluationState(segmentId, "running", null, definition);
  try {
    await segmentEvaluation.replaceDynamicMemberships(segmentId, compiled, segment.filterVersion);
  } catch (error) {
    await segmentEvaluation.setEvaluationState(
      segmentId,
      "failed",
      safeEvaluationError(error),
      definition,
    );
    throw error;
  }
  return true;
}

export async function reconcileContactSegmentMemberships(
  database: OpenEngageDatabase,
  workspaceId: string,
  contactId: string,
): Promise<void> {
  const segmentCatalog = new SegmentCatalogRepository(database, { workspaceId }),
    segmentEvaluation = new SegmentEvaluationRepository(database, { workspaceId });
  const definitions = await segmentCatalog.listDynamicDefinitions();
  // Compile the complete definition set before issuing a match query. A bad
  // stored definition must not leave earlier segments partially reconciled.
  const evaluations = definitions.map((definition) => ({
    ...definition,
    compiled: compileWorkspaceSegmentFilter(workspaceId, definition.filterAst),
  }));
  const updates: Array<{
    segmentId: string;
    filterVersion: number;
    contactId: string;
    matched: boolean;
  }> = [];
  for (const chunk of chunksOf(evaluations, 50)) {
    const matches = await segmentEvaluation.contactMatchesBatch(
      chunk.map((evaluation) => evaluation.compiled),
      contactId,
    );
    for (const [index, evaluation] of chunk.entries()) {
      updates.push({
        segmentId: evaluation.id,
        filterVersion: evaluation.filterVersion,
        contactId,
        matched: matches[index] ?? false,
      });
    }
  }
  for (const chunk of chunksOf(updates, 50)) {
    await segmentEvaluation.setDynamicMemberships(chunk);
  }
}

export async function listDynamicSegmentsForCorrection(
  database: OpenEngageDatabase,
): Promise<Array<{ workspaceId: string; segmentId: string; filterVersion: number }>> {
  return new SegmentMaintenanceRepository(database).listDynamicSegmentsForCorrection();
}

function safeEvaluationError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : "Segment evaluation failed";
}

function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
