import { and, desc, eq, exists, sql, type SQL } from "drizzle-orm";

import {
  assignmentGroupSchema,
  appNotificationSchema,
  salesHandoffResultSchema,
  type AssignmentGroupWrite,
  type SalesHandoff,
} from "@openengage/core/deals";

import { member, user } from "../auth/schema";
import { automationJobs } from "../automations/schema";
import { LifecycleRepository } from "../contacts/lifecycle-repository";
import { contacts } from "../contacts/schema";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { appNotifications, assignmentGroups, salesHandoffs } from "./sales-schema";
import { dealTasks } from "./schema";

export class SalesRepository extends WorkspaceRepository {
  async eligibleMembers() {
    return this.database.orm
      .select({ id: user.id, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(member.organizationId, this.context.workspaceId),
          sql`${member.role} IN ('owner','admin','marketer')`,
        ),
      );
  }
  async eligibleUser(userId: string): Promise<boolean> {
    return Boolean(
      await this.database.orm
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, this.context.workspaceId),
            eq(member.userId, userId),
            sql`${member.role} IN ('owner','admin','marketer')`,
          ),
        )
        .get(),
    );
  }
  async listGroups() {
    const rows = await this.database.orm
      .select()
      .from(assignmentGroups)
      .where(this.inWorkspace(assignmentGroups));
    return rows.map((row) =>
      assignmentGroupSchema.parse({ ...row, userIds: JSON.parse(row.userIds) }),
    );
  }
  async saveGroup(input: AssignmentGroupWrite) {
    for (const id of input.userIds)
      if (!(await this.eligibleUser(id)))
        throw new Error("Group users must be workspace members able to manage marketing");
    const id = input.id ?? uuidv7();
    const now = nowIso();
    if (input.id) {
      const result = await this.database.orm
        .update(assignmentGroups)
        .set({
          name: input.name,
          mode: input.mode,
          userIds: JSON.stringify([...new Set(input.userIds)]),
          updatedAt: now,
        })
        .where(and(this.inWorkspace(assignmentGroups), eq(assignmentGroups.id, id)))
        .returning({ id: assignmentGroups.id });
      if (!result.length) throw new Error("Assignment group not found");
    } else
      await this.database.orm.insert(assignmentGroups).values({
        id,
        workspaceId: this.context.workspaceId,
        name: input.name,
        mode: input.mode,
        userIds: JSON.stringify([...new Set(input.userIds)]),
        createdAt: now,
        updatedAt: now,
      });
    return (await this.listGroups()).find((group) => group.id === id)!;
  }
  async deleteGroup(id: string) {
    await this.database.orm
      .delete(assignmentGroups)
      .where(and(this.inWorkspace(assignmentGroups), eq(assignmentGroups.id, id)));
  }
  async notifications(userId: string) {
    const rows = await this.database.orm
      .select()
      .from(appNotifications)
      .where(and(this.inWorkspace(appNotifications), eq(appNotifications.userId, userId)))
      .orderBy(desc(appNotifications.createdAt))
      .limit(200);
    return rows.map((row) => appNotificationSchema.parse(row));
  }
  async markNotificationRead(id: string, userId: string) {
    await this.database.orm
      .update(appNotifications)
      .set({ readAt: nowIso() })
      .where(
        and(
          this.inWorkspace(appNotifications),
          eq(appNotifications.userId, userId),
          eq(appNotifications.id, id),
        ),
      );
  }

  /** Every decision and side effect is guarded by the newly inserted attempt receipt in one D1 transaction. */
  async handoffForAutomation(input: SalesHandoff, jobId: string, leaseId: string) {
    const authority = exists(
      this.database.orm
        .select({ id: automationJobs.id })
        .from(automationJobs)
        .where(
          and(
            eq(automationJobs.id, jobId),
            this.inWorkspace(automationJobs),
            eq(automationJobs.status, "running"),
            eq(automationJobs.leaseId, leaseId),
          ),
        ),
    );
    return this.handoff(input, authority);
  }
  async handoff(input: SalesHandoff, authority: SQL = sql`1=1`) {
    const orm = this.database.orm;
    const workspaceId = this.context.workspaceId;
    const previous = await orm
      .select()
      .from(salesHandoffs)
      .where(
        and(this.inWorkspace(salesHandoffs), eq(salesHandoffs.executionKey, input.executionKey)),
      )
      .get();
    if (previous) {
      if (previous.contactId !== input.contactId)
        throw new Error("Execution key belongs to a different contact");
      return salesHandoffResultSchema.parse(previous);
    }
    const id = uuidv7(),
      taskId = uuidv7(),
      now = nowIso();
    const eligibleGroup = sql`SELECT m.user_id FROM assignment_groups g, json_each(g.user_ids) j JOIN member m ON m.user_id=j.value AND m.organization_id=g.workspace_id AND m.role IN ('owner','admin','marketer') WHERE g.workspace_id=${workspaceId} AND g.id=${input.groupId ?? ""}`;
    const groupOwner = sql`(SELECT m.user_id FROM assignment_groups g, json_each(g.user_ids) j JOIN member m ON m.user_id=j.value AND m.organization_id=g.workspace_id AND m.role IN ('owner','admin','marketer') WHERE g.workspace_id=${workspaceId} AND g.id=${input.groupId ?? ""} ORDER BY CAST(j.key AS INTEGER) LIMIT 1 OFFSET COALESCE((SELECT CASE WHEN mode='fixed' THEN 0 ELSE cursor END FROM assignment_groups WHERE workspace_id=${workspaceId} AND id=${input.groupId ?? ""}),0) % MAX((SELECT COUNT(*) FROM (${eligibleGroup})),1))`;
    const explicitOwner = sql`(SELECT user_id FROM member WHERE organization_id=${workspaceId} AND user_id=${input.ownerUserId ?? ""} AND role IN ('owner','admin','marketer'))`;
    const existingOwner = sql`(SELECT user_id FROM member WHERE organization_id=${workspaceId} AND user_id=c.owner_user_id AND role IN ('owner','admin','marketer'))`;
    const owner = sql`COALESCE(${input.preserveOwner ? existingOwner : sql`NULL`},${input.groupId ? groupOwner : explicitOwner})`;
    const receipt = orm
      .select({ id: salesHandoffs.id })
      .from(salesHandoffs)
      .where(and(this.inWorkspace(salesHandoffs), eq(salesHandoffs.id, id)));
    const guard = exists(receipt);
    await orm.batch([
      orm
        .insert(salesHandoffs)
        .select(
          sql`SELECT ${id},${workspaceId},${input.executionKey},c.id,${owner},${taskId},${now} FROM contacts c WHERE c.workspace_id=${workspaceId} AND c.id=${input.contactId} AND c.status!='archived' AND ${authority} AND ${owner} IS NOT NULL AND ${input.groupId ? sql`EXISTS (${eligibleGroup})` : sql`1=1`}`,
        )
        .onConflictDoNothing(),
      orm
        .update(assignmentGroups)
        .set({ cursor: sql`${assignmentGroups.cursor}+1`, updatedAt: now })
        .where(
          and(
            this.inWorkspace(assignmentGroups),
            eq(assignmentGroups.id, input.groupId ?? ""),
            guard,
            input.preserveOwner
              ? sql`NOT EXISTS (SELECT 1 FROM contacts c JOIN member m ON m.user_id=c.owner_user_id AND m.organization_id=c.workspace_id AND m.role IN ('owner','admin','marketer') WHERE c.id=${input.contactId} AND c.workspace_id=${workspaceId})`
              : sql`1=1`,
          ),
        ),
      orm
        .update(contacts)
        .set({
          ownerUserId: sql`(SELECT owner_user_id FROM sales_handoffs WHERE id=${id})`,
          updatedAt: now,
        })
        .where(and(this.inWorkspace(contacts), eq(contacts.id, input.contactId), guard)),
      ...new LifecycleRepository(this.database, this.context).statements(
        input.contactId,
        "mql",
        now,
        `handoff:${input.executionKey}`,
        guard,
      ),
      orm
        .insert(dealTasks)
        .select(
          sql`SELECT ${taskId},${workspaceId},NULL,${input.contactId},'task',${input.title},'',${input.dueAt ?? null},'open',h.owner_user_id,NULL,${now},${now} FROM sales_handoffs h WHERE h.id=${id}`,
        ),
      orm
        .insert(appNotifications)
        .select(
          sql`SELECT ${id},${workspaceId},h.owner_user_id,${input.contactId},${input.title},NULL,${now} FROM sales_handoffs h WHERE h.id=${id}`,
        ),
    ]);
    const result = await orm
      .select()
      .from(salesHandoffs)
      .where(
        and(this.inWorkspace(salesHandoffs), eq(salesHandoffs.executionKey, input.executionKey)),
      )
      .get();
    if (!result || result.contactId !== input.contactId)
      throw new Error("No eligible sales owner or contact; handoff was not applied");
    return salesHandoffResultSchema.parse(result);
  }
}
