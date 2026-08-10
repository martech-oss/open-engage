import { and, asc, desc, eq, exists, sql, type SQL } from "drizzle-orm";

import {
  type CompiledSegment,
  segmentFilterSchema,
  type SegmentFilter,
} from "@openengage/core/segments";

import type { OpenEngageDatabase } from "../client";
import { subscriptionTopics } from "../consent/schema";
import {
  companies,
  contactEvents,
  contacts,
  customFieldDefinitions,
  tags,
} from "../contacts/schema";
import { nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { conditionalAudit } from "../web/project-brief-persistence";
import {
  authenticatedProjectActorId,
  approvedProjectLinkPrecondition,
  ProjectBriefLinkConflictError,
  type ApprovedProjectLink,
} from "../web/project-resource-guard";
import { projectBriefs, projectItems } from "../web/schema";
import { segmentMemberships, segments } from "./schema";

const filterAstCodec = defineJsonCodec(segmentFilterSchema, "segments.filter_ast");

export type SegmentRecord = Omit<typeof segments.$inferSelect, "filterAst"> & {
  filterAst: SegmentFilter | null;
};

export class SegmentRepository extends WorkspaceRepository {
  public async listSegments(): Promise<SegmentRecord[]> {
    const rows = await this.database.orm
      .select()
      .from(segments)
      .where(this.inWorkspace(segments))
      .orderBy(desc(segments.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows.map((row) => ({
      ...row,
      filterAst: filterAstCodec.decodeNullable(row.filterAst),
    }));
  }

  public async createSegment(input: {
    name: string;
    slug: string;
    description?: string | undefined;
    kind: "static" | "dynamic";
    filter?: SegmentFilter | undefined;
    membershipSource?: string | null | undefined;
    projectLink?: ApprovedProjectLink | undefined;
  }): Promise<{ id: string; createdAt: string; updatedAt: string }> {
    const id = uuidv7();
    const now = nowIso();
    const segmentValues = {
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      kind: input.kind,
      filterAst: input.filter ? filterAstCodec.encode(input.filter) : null,
      membershipSource: input.kind === "static" ? (input.membershipSource ?? null) : null,
      evaluationStatus: input.kind === "dynamic" ? "pending" : "ready",
      createdAt: now,
      updatedAt: now,
    };
    if (input.projectLink) {
      const link = input.projectLink;
      const precondition = approvedProjectLinkPrecondition(
        this.database.orm,
        this.context.workspaceId,
        authenticatedProjectActorId(this.context),
        link,
      );
      const [created] = await this.database.orm.batch([
        this.database.orm.insert(segments).select(
          sql`SELECT
            ${id}, ${this.context.workspaceId}, ${segmentValues.name}, ${segmentValues.slug},
            ${segmentValues.description}, ${segmentValues.kind}, ${segmentValues.filterAst},
            ${segmentValues.membershipSource}, 1, 0, NULL, ${segmentValues.evaluationStatus},
            NULL, ${now}, ${now}
          WHERE ${exists(precondition)}`,
        ),
        this.database.orm.insert(projectItems).select(
          sql`SELECT
            ${this.context.workspaceId}, ${link.projectId}, 'segment', ${id},
            ${link.briefRevision}, ${link.addedByUserId}, ${now}
          WHERE ${exists(precondition)}`,
        ),
        conditionalAudit(
          this.database.orm,
          this.context,
          link.addedByUserId,
          { action: "segment.create", resourceType: "segment", resourceId: id },
          precondition,
          now,
        ),
        conditionalAudit(
          this.database.orm,
          this.context,
          link.addedByUserId,
          {
            action: "project.item.add",
            resourceType: "project",
            resourceId: link.projectId,
            metadata: {
              resourceType: "segment",
              resourceId: id,
              briefRevision: link.briefRevision,
            },
          },
          precondition,
          now,
        ),
        this.database.orm
          .update(projectBriefs)
          .set({ rowVersion: sql`${projectBriefs.rowVersion} + 1`, updatedAt: now })
          .where(
            and(
              eq(projectBriefs.workspaceId, this.context.workspaceId),
              eq(projectBriefs.projectId, link.projectId),
              exists(precondition),
            ),
          ),
      ]);
      if (created.meta.changes !== 1) throw new ProjectBriefLinkConflictError();
    } else {
      await this.database.orm.insert(segments).values(segmentValues);
    }
    return { id, createdAt: now, updatedAt: now };
  }

  /**
   * Loads the fields a membership refresh needs. `kind` intentionally stays a
   * plain string: callers treat anything that is not "static" as dynamic.
   */
  public async findSegmentDefinition(id: string): Promise<{
    id: string;
    kind: string;
    filterAst: SegmentFilter | null;
    filterVersion: number;
  } | null> {
    const [row] = await this.database.orm
      .select({
        id: segments.id,
        kind: segments.kind,
        filterAst: segments.filterAst,
        filterVersion: segments.filterVersion,
      })
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.id, id)))
      .limit(1);
    return row ? { ...row, filterAst: filterAstCodec.decodeNullable(row.filterAst) } : null;
  }

  public async getSegment(id: string): Promise<SegmentRecord | null> {
    const [row] = await this.database.orm
      .select()
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.id, id)))
      .limit(1);
    return row ? { ...row, filterAst: filterAstCodec.decodeNullable(row.filterAst) } : null;
  }

  public async updateSegment(
    id: string,
    input: {
      name: string;
      slug: string;
      description: string;
      kind: "static" | "dynamic";
      filter?: SegmentFilter | undefined;
      membershipSource?: string | null | undefined;
    },
  ): Promise<{ filterVersion: number } | null> {
    const current = await this.getSegment(id);
    if (!current) return null;
    const filterVersion = current.filterVersion + 1;
    await this.database.orm
      .update(segments)
      .set({
        name: input.name,
        slug: input.slug,
        description: input.description,
        kind: input.kind,
        filterAst: input.filter ? filterAstCodec.encode(input.filter) : null,
        membershipSource: input.kind === "static" ? (input.membershipSource ?? null) : null,
        filterVersion,
        evaluationStatus: input.kind === "dynamic" ? "pending" : "ready",
        evaluationError: null,
        evaluatedAt: input.kind === "dynamic" ? current.evaluatedAt : null,
        updatedAt: nowIso(),
      })
      .where(and(this.inWorkspace(segments), eq(segments.id, id)));
    if (current.kind !== input.kind) {
      await this.database.orm
        .delete(segmentMemberships)
        .where(and(this.inWorkspace(segmentMemberships), eq(segmentMemberships.segmentId, id)));
      await this.updateMemberCount(id);
    }
    return { filterVersion };
  }

  public async setEvaluationState(
    segmentId: string,
    status: "pending" | "running" | "ready" | "failed",
    error: string | null = null,
  ): Promise<void> {
    await this.database.orm
      .update(segments)
      .set({ evaluationStatus: status, evaluationError: error, updatedAt: nowIso() })
      .where(and(this.inWorkspace(segments), eq(segments.id, segmentId)));
  }

  /** Recomputes the denormalized `member_count` of one segment. */
  public async updateMemberCount(segmentId: string): Promise<void> {
    await this.database.orm
      .update(segments)
      .set({ memberCount: memberCountExpression(), updatedAt: nowIso() })
      .where(and(this.inWorkspace(segments), eq(segments.id, segmentId)));
  }

  /**
   * Atomically (one D1 batch) replaces the dynamic memberships of a segment
   * with the contacts matched by the compiled filter, then refreshes the
   * denormalized member count and evaluation timestamp.
   */
  public async replaceDynamicMemberships(
    segmentId: string,
    compiled: CompiledSegment,
    filterVersion?: number,
  ): Promise<void> {
    if (filterVersion !== undefined) {
      const definition = await this.findSegmentDefinition(segmentId);
      if (!definition || definition.filterVersion !== filterVersion) return;
    }
    const now = nowIso();
    const orm = this.database.orm;
    await orm.batch([
      orm
        .delete(segmentMemberships)
        .where(
          and(
            this.inWorkspace(segmentMemberships),
            eq(segmentMemberships.segmentId, segmentId),
            eq(segmentMemberships.source, "dynamic"),
          ),
        ),
      // insert-from-select: drizzle emits the full column list in declaration
      // order, so the SELECT below lists workspace_id, segment_id, contact_id,
      // source, joined_at in exactly that order.
      orm
        .insert(segmentMemberships)
        .select(
          sql`SELECT ${this.context.workspaceId}, ${segmentId}, matched.id, 'dynamic', ${now}
              FROM (${compiledFilterSql(compiled)}) matched
              WHERE matched.status != 'archived'`,
        )
        .onConflictDoNothing(),
      orm
        .update(segments)
        .set({
          memberCount: memberCountExpression(),
          evaluatedAt: now,
          evaluationStatus: "ready",
          evaluationError: null,
          updatedAt: now,
        })
        .where(and(this.inWorkspace(segments), eq(segments.id, segmentId))),
    ]);
  }

  /** Runs the compiled filter and returns the matched contact rows, newest id first. */
  public async previewContacts(
    compiled: CompiledSegment,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    return await this.database.orm.all<Record<string, unknown>>(
      sql`SELECT * FROM (${compiledFilterSql(compiled)}) matched
          WHERE matched.status != 'archived' ORDER BY matched.id DESC LIMIT ${limit}`,
    );
  }

  public async previewCount(compiled: CompiledSegment): Promise<number> {
    const rows = await this.database.orm.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM (${compiledFilterSql(compiled)}) matched
          WHERE matched.status != 'archived'`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  public async loadGenerationCatalogRows(): Promise<{
    tags: Array<{ id: string; name: string; slug: string }>;
    staticSegments: Array<{ id: string; name: string; slug: string }>;
    companies: Array<{ id: string; name: string }>;
    subscriptionTopics: Array<{ id: string; name: string; slug: string; description: string }>;
    events: Array<{ type: string; resourceId: string | null }>;
    customFields: Array<{ id: string; key: string; label: string; dataType: string }>;
    stages: Array<{ stage: string }>;
  }> {
    const orm = this.database.orm;
    const [
      tagRows,
      staticSegmentRows,
      companyRows,
      topicRows,
      eventRows,
      customFieldRows,
      stageRows,
    ] = await orm.batch([
      orm
        .select({ id: tags.id, name: tags.name, slug: tags.slug })
        .from(tags)
        .where(this.inWorkspace(tags))
        .orderBy(asc(tags.name))
        .limit(1_000),
      orm
        .select({ id: segments.id, name: segments.name, slug: segments.slug })
        .from(segments)
        .where(and(this.inWorkspace(segments), eq(segments.kind, "static")))
        .orderBy(asc(segments.name))
        .limit(1_000),
      orm
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(this.inWorkspace(companies))
        .orderBy(asc(companies.name))
        .limit(1_000),
      orm
        .select({
          id: subscriptionTopics.id,
          name: subscriptionTopics.name,
          slug: subscriptionTopics.slug,
          description: subscriptionTopics.description,
        })
        .from(subscriptionTopics)
        .where(this.inWorkspace(subscriptionTopics))
        .orderBy(asc(subscriptionTopics.name))
        .limit(1_000),
      orm
        .selectDistinct({ type: contactEvents.type, resourceId: contactEvents.resourceId })
        .from(contactEvents)
        .where(this.inWorkspace(contactEvents))
        .orderBy(desc(contactEvents.occurredAt))
        .limit(1_000),
      orm
        .select({
          id: customFieldDefinitions.id,
          key: customFieldDefinitions.key,
          label: customFieldDefinitions.label,
          dataType: customFieldDefinitions.dataType,
        })
        .from(customFieldDefinitions)
        .where(
          and(
            this.inWorkspace(customFieldDefinitions),
            eq(customFieldDefinitions.entityType, "contact"),
          ),
        )
        .orderBy(asc(customFieldDefinitions.label))
        .limit(1_000),
      orm
        .selectDistinct({ stage: contacts.stage })
        .from(contacts)
        .where(this.inWorkspace(contacts))
        .orderBy(asc(contacts.stage))
        .limit(1_000),
    ]);
    return {
      tags: tagRows,
      staticSegments: staticSegmentRows,
      companies: companyRows,
      subscriptionTopics: topicRows,
      events: eventRows,
      customFields: customFieldRows,
      stages: stageRows,
    };
  }

  public async listDynamicDefinitions(
    limit = 1_000,
  ): Promise<Array<{ id: string; filterAst: SegmentFilter; filterVersion: number }>> {
    const rows = await this.database.orm
      .select({
        id: segments.id,
        filterAst: segments.filterAst,
        filterVersion: segments.filterVersion,
      })
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.kind, "dynamic")))
      .orderBy(asc(segments.id))
      .limit(limit);
    return rows.flatMap((row) => {
      const filterAst = filterAstCodec.decodeNullable(row.filterAst);
      return filterAst ? [{ id: row.id, filterAst, filterVersion: row.filterVersion }] : [];
    });
  }

  public async contactMatches(compiled: CompiledSegment, contactId: string): Promise<boolean> {
    const rows = await this.database.orm.all<{ matched: number }>(
      sql`SELECT 1 AS matched FROM (${compiledFilterSql(compiled)}) matched
          WHERE matched.id = ${contactId} AND matched.status != 'archived' LIMIT 1`,
    );
    return rows.length > 0;
  }

  public async setDynamicMembership(
    segmentId: string,
    contactId: string,
    matched: boolean,
  ): Promise<void> {
    const now = nowIso();
    const orm = this.database.orm;
    const membershipMutation = matched
      ? orm
          .insert(segmentMemberships)
          .values({
            workspaceId: this.context.workspaceId,
            segmentId,
            contactId,
            source: "dynamic",
            joinedAt: now,
          })
          .onConflictDoNothing()
      : orm
          .delete(segmentMemberships)
          .where(
            and(
              this.inWorkspace(segmentMemberships),
              eq(segmentMemberships.segmentId, segmentId),
              eq(segmentMemberships.contactId, contactId),
              eq(segmentMemberships.source, "dynamic"),
            ),
          );
    await orm.batch([
      membershipMutation,
      orm
        .update(segments)
        .set({
          memberCount: memberCountExpression(),
          evaluatedAt: now,
          evaluationStatus: "ready",
          evaluationError: null,
          updatedAt: now,
        })
        .where(and(this.inWorkspace(segments), eq(segments.id, segmentId))),
    ]);
  }
}

export class SegmentMaintenanceRepository {
  public constructor(private readonly database: OpenEngageDatabase) {}

  public listDynamicSegmentsForCorrection(): Promise<
    Array<{ workspaceId: string; segmentId: string; filterVersion: number }>
  > {
    return this.database.orm
      .select({
        workspaceId: segments.workspaceId,
        segmentId: segments.id,
        filterVersion: segments.filterVersion,
      })
      .from(segments)
      .where(eq(segments.kind, "dynamic"))
      .orderBy(asc(segments.workspaceId), asc(segments.id))
      .limit(10_000);
  }
}

/** Correlated subquery recomputing `segments.member_count` for the row being updated. */
function memberCountExpression(): SQL<number> {
  return sql<number>`(SELECT COUNT(*) FROM ${segmentMemberships}
    WHERE ${segmentMemberships.workspaceId} = ${segments.workspaceId}
      AND ${segmentMemberships.segmentId} = ${segments.id})`;
}

/**
 * Interleaves the compiled filter's `?` placeholders with its bound
 * parameters. The SQL text comes from `compileSegmentFilter`, which only emits
 * allowlisted identifiers (never user text), so `sql.raw` is safe for these
 * chunks — and only for these chunks.
 */
function compiledFilterSql(compiled: CompiledSegment): SQL {
  const parts = compiled.sql.split("?");
  if (parts.length !== compiled.params.length + 1) {
    throw new Error(
      `Compiled segment filter placeholder mismatch: expected ${parts.length - 1}, received ${compiled.params.length}`,
    );
  }
  const chunks: SQL[] = [];
  for (const [index, part] of parts.entries()) {
    if (part) chunks.push(sql.raw(part));
    if (index < compiled.params.length) chunks.push(sql`${compiled.params[index]}`);
  }
  return sql.join(chunks, sql.raw(""));
}
