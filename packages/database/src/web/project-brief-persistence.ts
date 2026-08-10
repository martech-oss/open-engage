import { exists, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import {
  definitionFromProjectBriefDocument,
  projectBriefDocumentV1Schema,
  upcastProjectBriefDocument,
  type MarketingAutomationBriefDefinition,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import type { Database } from "../client";
import { auditLogs } from "../platform/schema";
import { nowIso } from "../shared/database-utils";
import { uuidv7 } from "../shared/uuid";
import { projectBriefs } from "./schema";

/**
 * Reads both the legacy bare definition and the versioned document introduced
 * by migration 0004. All new writes use the versioned representation.
 */
export function decodeBriefDefinition(value: string): MarketingAutomationBriefDefinition {
  return definitionFromProjectBriefDocument(upcastProjectBriefDocument(JSON.parse(value)));
}

export function encodeBriefDefinition(definition: MarketingAutomationBriefDefinition): string {
  const document = projectBriefDocumentV1Schema.parse({ ...definition, schemaVersion: 1 });
  return JSON.stringify(document);
}

/** ISO timestamp with an extra three fractional digits for per-operation markers. */
export function uniqueOperationIso(): string {
  const now = nowIso();
  const entropy = (Number.parseInt(uuidv7().slice(-4), 16) % 1_000).toString().padStart(3, "0");
  return now.replace("Z", `${entropy}Z`);
}

export function projectBriefRevisionAuditMetadata(
  workspaceId: string,
  projectId: string,
  additional: Record<string, string | number | boolean | null> = {},
): SQL {
  const values = Object.entries(additional).flatMap(([key, value]) => [sql`${key}`, sql`${value}`]);
  const extras = values.length > 0 ? sql`, ${sql.join(values, sql`, `)}` : sql``;
  return sql`json_object(
    'revision', (
      SELECT ${projectBriefs.revision}
      FROM ${projectBriefs}
      WHERE ${projectBriefs.workspaceId} = ${workspaceId}
        AND ${projectBriefs.projectId} = ${projectId}
    )${extras}
  )`;
}

export interface ProjectAuditInput {
  action: string;
  projectId: string;
  metadata?: Record<string, unknown> | undefined;
  metadataSql?: SQL | undefined;
}

export interface ConditionalAuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  metadataSql?: SQL | undefined;
}

export function conditionalAudit(
  orm: Database,
  context: Pick<WorkspaceContext, "workspaceId"> & Partial<Pick<WorkspaceContext, "apiKeyId">>,
  actorUserId: string,
  input: ConditionalAuditInput,
  precondition: SQLWrapper,
  now: string,
) {
  return orm.insert(auditLogs).select(
    sql`SELECT
      ${uuidv7()},
      ${context.workspaceId},
      ${actorUserId},
      ${context.apiKeyId ?? null},
      ${input.action},
      ${input.resourceType},
      ${input.resourceId ?? null},
      ${input.metadataSql ?? JSON.stringify(input.metadata ?? {})},
      NULL,
      ${now}
    WHERE ${exists(precondition)}`,
  );
}

/**
 * Builds an audit INSERT that runs only while the supplied CAS precondition is
 * still true. It is intended to be placed immediately before the guarded
 * mutation in the same D1 batch.
 */
export function conditionalProjectAudit(
  orm: Database,
  context: WorkspaceContext,
  input: ProjectAuditInput,
  precondition: SQLWrapper,
  now: string,
) {
  if (context.apiKeyId) {
    return orm.insert(auditLogs).select(
      sql`SELECT
        ${uuidv7()}, ${context.workspaceId}, ${context.userId}, ${context.apiKeyId},
        ${input.action}, 'project', ${input.projectId},
        ${input.metadataSql ?? JSON.stringify(input.metadata ?? {})}, NULL, ${now}
      WHERE ${exists(precondition)}`,
    );
  }
  return conditionalAudit(
    orm,
    context,
    context.userId,
    {
      action: input.action,
      resourceType: "project",
      resourceId: input.projectId,
      metadata: input.metadata,
      metadataSql: input.metadataSql,
    },
    precondition,
    now,
  );
}
