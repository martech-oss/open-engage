import { and, asc, desc, eq, exists, isNull, like, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  programMemberMutationResultSchema,
  projectMemberSchema,
  projectMemberTransitionSchema,
  resolveProgramProgress,
  type ProgramMemberMutation,
  type ProgramMemberMutationResult,
  type ProjectMember,
  type ProgramCohortInput,
} from "@openengage/core/projects";

import { runningActionLeaseExists } from "../automations/action-authority";
import { automationEnrollments, automationJobs } from "../automations/schema";
import { contactEventProjectionRows } from "../contacts/event-repository";
import {
  contacts,
  contactEvents,
  contactEventOutbox,
  contactEventProjections,
} from "../contacts/schema";
import { escapeLike, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { ProjectProgramRepository, ProgramError } from "./program-repository";
import {
  projectMembers,
  projectMemberTransitions,
  projectMemberCommands,
  projectPrograms,
} from "./program-schema";
import { projects } from "./schema";

export interface ProgramMutationAuthority {
  jobId: string;
  leaseId: string;
  enrollmentId: string;
}
export type ProgramMemberCommand = Omit<ProgramMemberMutation, "source" | "mode"> & {
  source: ProgramMemberMutation["source"];
  mode?: ProgramMemberMutation["mode"];
  actorUserId?: string;
  authority?: ProgramMutationAuthority;
};
export function isProgramWriteConflict(error: unknown) {
  return (
    error instanceof Error &&
    /NOT NULL constraint failed: project_member_commands.result|UNIQUE constraint failed: project_member_commands/i.test(
      error.message,
    )
  );
}

export class ProjectMemberRepository extends WorkspaceRepository {
  public async get(projectId: string, contactId: string): Promise<ProjectMember | null> {
    const row = await this.database.orm
      .select()
      .from(projectMembers)
      .where(
        and(
          this.inWorkspace(projectMembers),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.contactId, contactId),
        ),
      )
      .get();
    return row ? projectMemberSchema.parse(row) : null;
  }
  public async prior(projectId: string, key: string) {
    return this.database.orm
      .select()
      .from(projectMemberCommands)
      .where(
        and(
          this.inWorkspace(projectMemberCommands),
          eq(projectMemberCommands.projectId, projectId),
          eq(projectMemberCommands.idempotencyKey, key),
        ),
      )
      .get();
  }
  public async findContact(input: { contactId?: string; email?: string }) {
    if (!input.contactId && !input.email) return null;
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          this.inWorkspace(contacts),
          isNull(contacts.archivedAt),
          input.contactId ? eq(contacts.id, input.contactId) : undefined,
          input.email ? eq(contacts.email, input.email.trim().toLowerCase()) : undefined,
        ),
      )
      .get();
    return row?.id ?? null;
  }
  /** Builds statements for inclusion in the public form's existing atomic D1 batch. */
  public async prepareMutation(
    input: ProgramMemberCommand,
    now = nowIso(),
  ): Promise<{ statements: BatchItem<"sqlite">[]; result: ProgramMemberMutationResult }> {
    const fingerprint = JSON.stringify({
      contactId: input.contactId,
      statusId: input.statusId ?? null,
      definitionVersion: input.definitionVersion ?? null,
      source: input.source,
      mode: input.mode ?? "progress",
      reason: input.reason ?? null,
      expectedRevision: input.expectedRevision ?? null,
    });
    const prior = await this.prior(input.projectId, input.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ProgramError("conflict", "Idempotency key was used with different member input");
      return {
        statements: [],
        result: {
          ...programMemberMutationResultSchema.parse(JSON.parse(prior.result)),
          duplicate: true,
        },
      };
    }
    const programRepository = new ProjectProgramRepository(this.database, this.context);
    const program = await programRepository.get(input.projectId);
    const current = await this.get(input.projectId, input.contactId);
    const definitionVersion =
      current?.definitionVersion ?? input.definitionVersion ?? program?.publishedVersion;
    if (!definitionVersion)
      throw new ProgramError("invalid", "Publish the program before enrolling members");
    if (
      current &&
      input.source !== "form" &&
      input.definitionVersion !== undefined &&
      input.definitionVersion !== current.definitionVersion
    )
      throw new ProgramError("conflict", "Member retains its enrollment definition version");
    if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0))
      throw new ProgramError("conflict", "Member was changed by another writer");
    const definition = await programRepository.definition(input.projectId, definitionVersion);
    const preservePinnedMember = Boolean(
      current &&
      input.source === "form" &&
      input.definitionVersion !== undefined &&
      input.definitionVersion !== definitionVersion &&
      input.statusId &&
      !definition.statuses.some((status) => status.id === input.statusId),
    );
    if (preservePinnedMember) {
      const incomingDefinition = await programRepository.definition(
        input.projectId,
        input.definitionVersion!,
      );
      if (!incomingDefinition.statuses.some((status) => status.id === input.statusId))
        throw new ProgramError("invalid", "Unknown status in form definition version");
    }
    let resolved: ReturnType<typeof resolveProgramProgress>;
    try {
      resolved = resolveProgramProgress(
        definition,
        current,
        preservePinnedMember ? { ...input, statusId: current!.statusId } : input,
        now,
      );
    } catch (error) {
      throw new ProgramError(
        "invalid",
        error instanceof Error ? error.message : "Invalid progress",
      );
    }
    // Every state change has a strictly ordered timestamp even within one millisecond.
    const occurredAt =
      current && now <= current.updatedAt
        ? new Date(Date.parse(current.updatedAt) + 1).toISOString()
        : now;
    if (resolved.firstSuccessAt === now) resolved.firstSuccessAt = occurredAt;
    const changed =
      !current ||
      current.statusId !== resolved.statusId ||
      current.firstSuccessAt !== resolved.firstSuccessAt ||
      input.mode === "correction";
    const target = definition.statuses.find((s) => s.id === resolved.statusId)!;
    const member: ProjectMember = changed
      ? {
          id: current?.id ?? uuidv7(),
          workspaceId: this.context.workspaceId,
          projectId: input.projectId,
          contactId: input.contactId,
          definitionVersion,
          ...resolved,
          statusLabel: target.label,
          joinedAt: current?.joinedAt ?? occurredAt,
          source: current?.source ?? input.source,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: occurredAt,
        }
      : current!;
    const transitionId = uuidv7();
    const eventTypes = changed
      ? [
          current ? "project_member_progressed" : "project_member_joined",
          ...(!current?.firstSuccessAt && member.firstSuccessAt
            ? ["project_member_succeeded"]
            : []),
        ]
      : [];
    const eventIds = eventTypes.map(() => uuidv7());
    const result = {
      member,
      duplicate: false,
      eventIds,
      ...(preservePinnedMember
        ? { unchangedReason: "pinned_definition_status_unavailable" as const }
        : {}),
    };
    const orm = this.database.orm;
    const guard = and(
      exists(
        orm
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              this.inWorkspace(projects),
              eq(projects.id, input.projectId),
              isNull(projects.archivedAt),
            ),
          ),
      ),
      exists(
        orm
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              this.inWorkspace(contacts),
              eq(contacts.id, input.contactId),
              isNull(contacts.archivedAt),
            ),
          ),
      ),
      sql`COALESCE((SELECT ${projectMembers.revision} FROM ${projectMembers} WHERE ${projectMembers.workspaceId}=${this.context.workspaceId} AND ${projectMembers.projectId}=${input.projectId} AND ${projectMembers.contactId}=${input.contactId}),0)=${current?.revision ?? 0}`,
      !current && input.definitionVersion === undefined
        ? exists(
            orm
              .select({ id: projectPrograms.projectId })
              .from(projectPrograms)
              .where(
                and(
                  this.inWorkspace(projectPrograms),
                  eq(projectPrograms.projectId, input.projectId),
                  eq(projectPrograms.publishedVersion, definitionVersion),
                ),
              ),
          )
        : undefined,
      input.authority
        ? and(
            runningActionLeaseExists(this.database, {
              workspaceId: this.context.workspaceId,
              jobId: input.authority.jobId,
              leaseId: input.authority.leaseId,
            }),
            exists(
              orm
                .select({ id: automationEnrollments.id })
                .from(automationEnrollments)
                .innerJoin(
                  automationJobs,
                  eq(automationJobs.enrollmentId, automationEnrollments.id),
                )
                .where(
                  and(
                    eq(automationJobs.id, input.authority.jobId),
                    eq(automationEnrollments.id, input.authority.enrollmentId),
                    eq(automationEnrollments.workspaceId, this.context.workspaceId),
                    eq(automationEnrollments.contactId, input.contactId),
                    eq(automationEnrollments.status, "active"),
                  ),
                ),
            ),
          )
        : undefined,
    );
    const statements: BatchItem<"sqlite">[] = [
      orm.insert(projectMemberCommands).values({
        workspaceId: this.context.workspaceId,
        projectId: input.projectId,
        idempotencyKey: input.idempotencyKey,
        fingerprint,
        result: sql`CASE WHEN ${guard} THEN ${JSON.stringify(result)} ELSE NULL END`,
        createdAt: occurredAt,
      }),
    ];
    if (changed) {
      statements.push(
        current
          ? orm
              .update(projectMembers)
              .set(member)
              .where(and(this.inWorkspace(projectMembers), eq(projectMembers.id, current.id)))
          : orm.insert(projectMembers).values(member),
      );
      statements.push(
        orm.insert(projectMemberTransitions).values({
          id: transitionId,
          workspaceId: this.context.workspaceId,
          projectId: input.projectId,
          memberId: member.id,
          contactId: input.contactId,
          definitionVersion,
          revision: member.revision,
          previousStatusId: current?.statusId ?? null,
          statusId: member.statusId,
          statusLabel: member.statusLabel,
          success: target.success,
          firstSuccessAt: member.firstSuccessAt,
          source: input.source,
          mode: input.mode ?? "progress",
          reason: input.reason ?? null,
          actorUserId: input.actorUserId ?? null,
          occurredAt,
        }),
      );
      for (let i = 0; i < eventTypes.length; i++) {
        const id = eventIds[i]!;
        statements.push(
          orm.insert(contactEvents).values({
            id,
            workspaceId: this.context.workspaceId,
            contactId: input.contactId,
            type: eventTypes[i]!,
            resourceType: "project",
            resourceId: input.projectId,
            properties: JSON.stringify({
              projectId: input.projectId,
              memberId: member.id,
              definitionVersion,
              statusId: member.statusId,
              previousStatusId: current?.statusId ?? null,
              firstSuccessAt: member.firstSuccessAt,
              transitionId,
              mode: input.mode ?? "progress",
            }),
            occurredAt,
            createdAt: occurredAt,
          }),
          orm.insert(contactEventOutbox).values({
            eventId: id,
            workspaceId: this.context.workspaceId,
            status: "pending",
            createdAt: occurredAt,
          }),
          orm.insert(contactEventProjections).values(
            contactEventProjectionRows({
              id,
              workspaceId: this.context.workspaceId,
              createdAt: occurredAt,
            }),
          ),
        );
      }
    }
    return { statements, result };
  }
  public async mutate(input: ProgramMemberCommand): Promise<ProgramMemberMutationResult> {
    await new ProjectProgramRepository(this.database, this.context).project(input.projectId);
    if (!(await this.findContact({ contactId: input.contactId })))
      throw new ProgramError("not_found", "Contact not found in workspace");
    for (let attempt = 0; attempt < 4; attempt++) {
      const prepared = await this.prepareMutation(input);
      if (!prepared.statements.length) return prepared.result;
      try {
        await this.database.orm.batch(
          prepared.statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
        );
        return prepared.result;
      } catch (error) {
        if (!isProgramWriteConflict(error)) throw error;
      }
    }
    throw new ProgramError(
      "conflict",
      "Member changed or automation authority is no longer active",
    );
  }
  public async list(
    projectId: string,
    input: {
      query?: string | undefined;
      statusId?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    },
  ) {
    await new ProjectProgramRepository(this.database, this.context).project(projectId);
    const predicate = and(
      this.inWorkspace(projectMembers),
      eq(projectMembers.projectId, projectId),
      input.statusId ? eq(projectMembers.statusId, input.statusId) : undefined,
      input.query
        ? or(
            like(contacts.email, `%${escapeLike(input.query)}%`),
            like(contacts.firstName, `%${escapeLike(input.query)}%`),
            like(contacts.lastName, `%${escapeLike(input.query)}%`),
            eq(contacts.id, input.query),
          )
        : undefined,
    );
    const rows = await this.database.orm
      .select({
        member: projectMembers,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(projectMembers)
      .innerJoin(
        contacts,
        and(
          eq(contacts.workspaceId, projectMembers.workspaceId),
          eq(contacts.id, projectMembers.contactId),
        ),
      )
      .where(predicate)
      .orderBy(desc(projectMembers.joinedAt), asc(projectMembers.id))
      .limit(input.limit ?? 50)
      .offset(input.offset ?? 0);
    const total = await this.database.orm
      .select({ total: sql<number>`count(*)` })
      .from(projectMembers)
      .innerJoin(
        contacts,
        and(
          eq(contacts.workspaceId, projectMembers.workspaceId),
          eq(contacts.id, projectMembers.contactId),
        ),
      )
      .where(predicate)
      .get();
    return {
      items: rows.map((r) => ({ ...r, member: projectMemberSchema.parse(r.member) })),
      total: total?.total ?? 0,
    };
  }
  public async history(projectId: string, contactId: string) {
    await new ProjectProgramRepository(this.database, this.context).project(projectId);
    return (
      await this.database.orm
        .select()
        .from(projectMemberTransitions)
        .where(
          and(
            this.inWorkspace(projectMemberTransitions),
            eq(projectMemberTransitions.projectId, projectId),
            eq(projectMemberTransitions.contactId, contactId),
          ),
        )
        .orderBy(asc(projectMemberTransitions.revision))
    ).map((r) => projectMemberTransitionSchema.parse(r));
  }
  public async cohort(projectId: string, input: ProgramCohortInput) {
    await new ProjectProgramRepository(this.database, this.context).project(projectId);
    const row = await this.database.first<{
      members: number;
      succeeded: number;
      averageTimeToSuccessSeconds: number | null;
    }>(sql`
      SELECT count(*) AS members,coalesce(sum(CASE WHEN t.first_success_at IS NOT NULL AND t.first_success_at<=${input.asOf} THEN 1 ELSE 0 END),0) AS succeeded,
      avg(CASE WHEN t.first_success_at IS NOT NULL AND t.first_success_at<=${input.asOf} THEN max(0,(julianday(t.first_success_at)-julianday(m.joined_at))*86400) ELSE NULL END) AS averageTimeToSuccessSeconds
      FROM project_members m LEFT JOIN project_member_transitions t ON t.workspace_id=m.workspace_id AND t.member_id=m.id AND t.revision=(SELECT max(h.revision) FROM project_member_transitions h WHERE h.workspace_id=m.workspace_id AND h.member_id=m.id AND h.occurred_at<=${input.asOf})
      WHERE m.workspace_id=${this.context.workspaceId} AND m.project_id=${projectId} AND m.joined_at>=${input.from} AND m.joined_at<${input.to} AND m.joined_at<=${input.asOf}`);
    const result = row ?? { members: 0, succeeded: 0, averageTimeToSuccessSeconds: null };
    return { ...input, ...result, rate: result.members ? result.succeeded / result.members : 0 };
  }
}
