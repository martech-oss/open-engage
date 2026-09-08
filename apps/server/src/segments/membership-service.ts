import { type OpenEngageDatabase } from "@openengage/database/client";
import { compileWorkspaceSegmentFilter } from "@openengage/database/segments";
import { SegmentMaintenanceRepository, SegmentRepository } from "@openengage/database/segments";

/** These helpers are called from flows that only carry a workspace id (bulk contact actions, membership refreshes). */
function segmentRepository(database: OpenEngageDatabase, workspaceId: string): SegmentRepository {
  return new SegmentRepository(database, { workspaceId });
}

export async function updateSegmentMemberCount(
  database: OpenEngageDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<void> {
  await segmentRepository(database, workspaceId).updateMemberCount(segmentId);
}

export async function refreshSegmentMemberships(
  database: OpenEngageDatabase,
  workspaceId: string,
  segmentId: string,
  expectedFilterVersion?: number,
): Promise<boolean> {
  const repository = segmentRepository(database, workspaceId);
  const segment = await repository.findSegmentDefinition(segmentId);
  if (!segment) return false;
  if (expectedFilterVersion !== undefined && segment.filterVersion !== expectedFilterVersion) {
    return true;
  }
  if (segment.kind === "static") {
    await repository.updateMemberCount(segmentId, {
      kind: "static",
      filterVersion: segment.filterVersion,
    });
    return true;
  }
  if (!segment.filterAst) return false;
  const compiled = compileWorkspaceSegmentFilter(workspaceId, segment.filterAst);
  const definition = { kind: "dynamic" as const, filterVersion: segment.filterVersion };
  await repository.setEvaluationState(segmentId, "running", null, definition);
  try {
    await repository.replaceDynamicMemberships(segmentId, compiled, segment.filterVersion);
  } catch (error) {
    await repository.setEvaluationState(
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
  const repository = segmentRepository(database, workspaceId);
  const definitions = await repository.listDynamicDefinitions();
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
    const matches = await repository.contactMatchesBatch(
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
    await repository.setDynamicMemberships(chunk);
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
