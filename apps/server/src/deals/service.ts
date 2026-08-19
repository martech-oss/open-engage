import type {
  DealCreate,
  DealDetailData,
  DealListData,
  DealOptions,
  DealPipeline,
  DealPipelineCreate,
  DealPipelineUpdate,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskListItem,
  DealTaskStatus,
  DealTaskUpdate,
  DealUpdate,
} from "@openengage/core/deals";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { DealRepository } from "@openengage/database/deals";
import { writeAuditLog } from "@openengage/database/platform";
import { ensureLoaded } from "@openengage/database/shared";

import {
  serializeDeal,
  serializePipeline,
  serializeStage,
  serializeTask,
  serializeTaskListItem,
} from "./records";

/** Deals list needs a pipeline; a missing one is distinct from an empty list. */
export type DealListOutcome = { kind: "pipeline_not_found" } | { kind: "ok"; data: DealListData };
export type DealWriteOutcome =
  | { kind: "invalid_reference"; message: string }
  | { kind: "not_found" }
  | { kind: "ok"; deal: DealSummary };
export type DealMoveOutcome =
  | { kind: "not_found" }
  | { kind: "invalid_stage" }
  | { kind: "ok"; deal: DealSummary };
export type DealTaskOutcome =
  | { kind: "not_found" }
  | { kind: "invalid_assignee" }
  | { kind: "ok"; task: DealTask };
export type PipelineCreateOutcome = { kind: "conflict" } | { kind: "ok"; pipeline: DealPipeline };
export type PipelineWriteOutcome =
  | { kind: "conflict" }
  | { kind: "default_required" }
  | { kind: "not_found" }
  | { kind: "stage_in_use" }
  | { kind: "ok"; pipeline: DealPipeline };
export type PipelineArchiveOutcome =
  | { kind: "not_found" }
  | { kind: "last" }
  | { kind: "in_use" }
  | { kind: "ok" };

interface Background {
  waitUntil(promise: Promise<unknown>): void;
}

export async function getDealOptions(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<DealOptions> {
  const repository = new DealRepository(database, workspace);
  await repository.ensureDefaultPipeline();
  const rows = await repository.getDealOptionRows();

  const stagesByPipeline = new Map<string, typeof rows.stages>();
  for (const stage of rows.stages) {
    const stages = stagesByPipeline.get(stage.pipelineId) ?? [];
    stages.push(stage);
    stagesByPipeline.set(stage.pipelineId, stages);
  }

  return {
    pipelines: rows.pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: Boolean(pipeline.isDefault),
      stages: (stagesByPipeline.get(pipeline.id) ?? []).map(serializeStage),
    })),
    contacts: rows.contacts,
    companies: rows.companies,
    members: rows.members,
  };
}

export async function listDeals(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: {
    pipelineId?: string | undefined;
    status: "open" | "won" | "lost" | "all";
    q?: string | undefined;
  },
): Promise<DealListOutcome> {
  const repository = new DealRepository(database, workspace);
  const defaultPipelineId = await repository.ensureDefaultPipeline();
  const pipelineId = input.pipelineId ?? defaultPipelineId;
  if (!(await repository.pipelineExists(pipelineId))) {
    return { kind: "pipeline_not_found" };
  }

  const { items, summary } = await repository.listDeals({
    pipelineId,
    status: input.status,
    q: input.q,
  });

  return {
    kind: "ok",
    data: {
      items: items.map(serializeDeal),
      summary: {
        openCount: Number(summary?.openCount ?? 0),
        openValue: Number(summary?.openValue ?? 0),
        wonCount: Number(summary?.wonCount ?? 0),
        wonValue: Number(summary?.wonValue ?? 0),
        lostCount: Number(summary?.lostCount ?? 0),
      },
    },
  };
}

export async function listWorkspaceDealTasks(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  status: DealTaskStatus | "all",
): Promise<DealTaskListItem[]> {
  const repository = new DealRepository(database, workspace);
  const rows = await repository.listWorkspaceTasks(status);
  return rows.map(serializeTaskListItem);
}

export async function getDealDetail(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<DealDetailData | null> {
  const repository = new DealRepository(database, workspace);
  const deal = await repository.getDeal(id);
  if (!deal) return null;
  const tasks = await repository.listDealTasks(deal.id);
  return { deal: serializeDeal(deal), tasks: tasks.map(serializeTask) };
}

export async function createDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: DealCreate,
  background: Background,
): Promise<DealWriteOutcome> {
  const repository = new DealRepository(database, workspace);
  const referenceError = await repository.validateDealReferences(input);
  if (referenceError) return { kind: "invalid_reference", message: referenceError };

  const deal = await repository.createDeal(input);
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.create",
      resourceType: "deal",
      resourceId: deal.id,
    }),
  );
  return { kind: "ok", deal: serializeDeal(deal) };
}

/** Patch semantics: unset fields keep the stored value, so the merge happens here. */
export async function updateDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: DealUpdate,
  background: Background,
): Promise<DealWriteOutcome> {
  const repository = new DealRepository(database, workspace);
  const current = await repository.getDeal(id);
  if (!current) return { kind: "not_found" };

  const merged: DealCreate = {
    name: input.name ?? current.name,
    pipelineId: input.pipelineId ?? current.pipelineId,
    stageId: input.stageId ?? current.stageId,
    value: input.value ?? Number(current.value),
    currency: input.currency ?? current.currency,
    status: input.status ?? current.status,
    ownerUserId: input.ownerUserId === undefined ? current.ownerUserId : input.ownerUserId,
    contactId: input.contactId === undefined ? current.contactId : input.contactId,
    companyId: input.companyId === undefined ? current.companyId : input.companyId,
    expectedCloseDate:
      input.expectedCloseDate === undefined ? current.expectedCloseDate : input.expectedCloseDate,
    description: input.description ?? current.description,
  };
  const referenceError = await repository.validateDealReferences(merged);
  if (referenceError) return { kind: "invalid_reference", message: referenceError };

  const now = new Date().toISOString();
  const wonAt = merged.status === "won" ? (current.status === "won" ? current.wonAt : now) : null;
  const lostAt =
    merged.status === "lost" ? (current.status === "lost" ? current.lostAt : now) : null;
  await repository.updateDeal(current.id, { ...merged, wonAt, lostAt, updatedAt: now });
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: current.status === merged.status ? "deal.update" : "deal.status_change",
      resourceType: "deal",
      resourceId: current.id,
      ...(current.status === merged.status
        ? {}
        : { metadata: { previousStatus: current.status, status: merged.status } }),
    }),
  );
  const deal = await repository.getDeal(current.id);
  return { kind: "ok", deal: serializeDeal(ensureLoaded(deal, "Updated deal")) };
}

export async function moveDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  stageId: string,
  background: Background,
): Promise<DealMoveOutcome> {
  const repository = new DealRepository(database, workspace);
  const deal = await repository.getDeal(id);
  if (!deal) return { kind: "not_found" };
  if (!(await repository.stageExistsInPipeline(deal.pipelineId, stageId))) {
    return { kind: "invalid_stage" };
  }
  const updated = await repository.moveDeal(deal.id, stageId);
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.move",
      resourceType: "deal",
      resourceId: deal.id,
      metadata: { previousStageId: deal.stageId, stageId },
    }),
  );
  return { kind: "ok", deal: serializeDeal(ensureLoaded(updated, "Moved deal")) };
}

export async function archiveDeal(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  background: Background,
): Promise<boolean> {
  const repository = new DealRepository(database, workspace);
  if (!(await repository.archiveDeal(id))) return false;
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.archive",
      resourceType: "deal",
      resourceId: id,
    }),
  );
  return true;
}

export async function createDealTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  input: DealTaskCreate,
): Promise<DealTaskOutcome> {
  const repository = new DealRepository(database, workspace);
  if (!(await repository.dealExists(dealId))) return { kind: "not_found" };
  if (input.assignedUserId && !(await repository.memberExists(input.assignedUserId))) {
    return { kind: "invalid_assignee" };
  }
  const task = await repository.createDealTask(dealId, input);
  return { kind: "ok", task: serializeTask(task) };
}

export async function updateDealTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  taskId: string,
  input: DealTaskUpdate,
): Promise<DealTaskOutcome> {
  const repository = new DealRepository(database, workspace);
  const current = await repository.getTask(dealId, taskId);
  if (!current) return { kind: "not_found" };
  const assignedUserId =
    input.assignedUserId === undefined ? current.assignedUserId : input.assignedUserId;
  if (assignedUserId && !(await repository.memberExists(assignedUserId))) {
    return { kind: "invalid_assignee" };
  }
  const status = input.status ?? current.status;
  const now = new Date().toISOString();
  // Keep the original completion time when a task was already completed.
  const completedAt =
    status === "completed" ? (current.status === "completed" ? current.completedAt : now) : null;
  const task = await repository.updateDealTask(dealId, taskId, {
    type: input.type ?? current.type,
    title: input.title ?? current.title,
    notes: input.notes ?? current.notes,
    dueAt: input.dueAt === undefined ? current.dueAt : input.dueAt,
    status,
    assignedUserId,
    completedAt,
    updatedAt: now,
  });
  return { kind: "ok", task: serializeTask(ensureLoaded(task, "Updated deal task")) };
}

export async function deleteDealTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  dealId: string,
  taskId: string,
): Promise<boolean> {
  const repository = new DealRepository(database, workspace);
  return repository.deleteDealTask(dealId, taskId);
}

export async function createDealPipeline(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: DealPipelineCreate,
  background: Background,
): Promise<PipelineCreateOutcome> {
  const repository = new DealRepository(database, workspace);
  const created = await repository.createPipeline(input);
  if (created.kind === "conflict") return { kind: "conflict" };
  const loaded = ensureLoaded(
    await repository.getPipelineWithStages(created.id),
    "Created deal pipeline",
  );
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.pipeline.create",
      resourceType: "deal_pipeline",
      resourceId: loaded.pipeline.id,
    }),
  );
  return { kind: "ok", pipeline: serializePipeline(loaded.pipeline, loaded.stages) };
}

export async function updateDealPipeline(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: DealPipelineUpdate,
  background: Background,
): Promise<PipelineWriteOutcome> {
  const repository = new DealRepository(database, workspace);
  const result = await repository.updatePipeline(id, input);
  if (result !== "ok") return { kind: result };
  const loaded = ensureLoaded(await repository.getPipelineWithStages(id), "Updated deal pipeline");
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "deal.pipeline.update",
      resourceType: "deal_pipeline",
      resourceId: id,
    }),
  );
  return { kind: "ok", pipeline: serializePipeline(loaded.pipeline, loaded.stages) };
}

export async function archiveDealPipeline(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  background: Background,
): Promise<PipelineArchiveOutcome> {
  const repository = new DealRepository(database, workspace);
  const result = await repository.archivePipeline(id);
  if (result === "ok") {
    background.waitUntil(
      writeAuditLog(database, workspace, {
        action: "deal.pipeline.archive",
        resourceType: "deal_pipeline",
        resourceId: id,
      }),
    );
  }
  return { kind: result };
}
