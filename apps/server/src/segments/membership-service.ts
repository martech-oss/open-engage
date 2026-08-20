import { compileSegmentFilter } from "@openengage/core/segments";
import { type OpenEngageDatabase } from "@openengage/database/client";
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
    await repository.updateMemberCount(segmentId);
    return true;
  }
  if (!segment.filterAst) return false;
  const compiled = compileSegmentFilter(workspaceId, segment.filterAst);
  await repository.setEvaluationState(segmentId, "running");
  try {
    await repository.replaceDynamicMemberships(segmentId, compiled, expectedFilterVersion);
  } catch (error) {
    await repository.setEvaluationState(segmentId, "failed", safeEvaluationError(error));
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
  for (const definition of definitions) {
    const compiled = compileSegmentFilter(workspaceId, definition.filterAst);
    const matched = await repository.contactMatches(compiled, contactId);
    await repository.setDynamicMembership(definition.id, contactId, matched);
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
