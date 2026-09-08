import * as z from "zod";

const statusIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const projectProgramKindSchema = z.enum(["resource_request", "inquiry", "event", "custom"]);
export const projectProgramStatusSchema = z.object({
  id: statusIdSchema,
  label: z.string().trim().min(1).max(120),
  success: z.boolean(),
  nextStatusIds: z.array(statusIdSchema).max(50),
});
export const projectProgramDefinitionSchema = z
  .object({
    kind: projectProgramKindSchema,
    initialStatusId: statusIdSchema,
    statuses: z.array(projectProgramStatusSchema).min(1).max(50),
  })
  .superRefine((definition, ctx) => {
    const byId = new Map(definition.statuses.map((s) => [s.id, s]));
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (byId.size !== definition.statuses.length) issue("Status identifiers must be unique");
    if (!byId.has(definition.initialStatusId)) issue("Initial status must exist");
    if (!definition.statuses.some((s) => s.success))
      issue("At least one success status is required");
    for (const status of definition.statuses)
      for (const next of status.nextStatusIds)
        if (!byId.has(next)) issue(`Unknown next status: ${next}`);
    const done = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return false;
      if (done.has(id)) return true;
      visiting.add(id);
      for (const next of byId.get(id)?.nextStatusIds ?? []) if (!visit(next)) return false;
      visiting.delete(id);
      done.add(id);
      return true;
    };
    if (definition.statuses.some((s) => !visit(s.id)))
      issue("Status graph must not contain cycles");
  });
export type ProjectProgramDefinition = z.infer<typeof projectProgramDefinitionSchema>;
export type ProjectProgramStatus = z.infer<typeof projectProgramStatusSchema>;
export const projectMemberSourceSchema = z.enum(["manual", "api", "csv", "form", "automation"]);
export type ProjectMemberSource = z.infer<typeof projectMemberSourceSchema>;
export const projectMemberSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  contactId: z.string(),
  definitionVersion: z.number().int().positive(),
  statusId: statusIdSchema,
  statusLabel: z.string(),
  joinedAt: z.iso.datetime(),
  firstSuccessAt: z.iso.datetime().nullable(),
  source: projectMemberSourceSchema,
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;
export const projectMemberTransitionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  memberId: z.string(),
  contactId: z.string(),
  definitionVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  previousStatusId: statusIdSchema.nullable(),
  statusId: statusIdSchema,
  statusLabel: z.string(),
  success: z.boolean(),
  firstSuccessAt: z.iso.datetime().nullable(),
  source: projectMemberSourceSchema,
  mode: z.enum(["progress", "correction"]),
  reason: z.string().nullable(),
  actorUserId: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});
export type ProjectMemberTransition = z.infer<typeof projectMemberTransitionSchema>;
export const programMemberMutationSchema = z.object({
  projectId: z.string().min(1),
  contactId: z.string().min(1),
  statusId: statusIdSchema.optional(),
  definitionVersion: z.number().int().positive().optional(),
  source: projectMemberSourceSchema.default("api"),
  idempotencyKey: z.string().min(8).max(191),
  mode: z.enum(["progress", "correction"]).default("progress"),
  reason: z.string().trim().min(1).max(2000).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});
export type ProgramMemberMutation = z.infer<typeof programMemberMutationSchema>;
export const programMemberMutationResultSchema = z.object({
  member: projectMemberSchema,
  duplicate: z.boolean(),
  eventIds: z.array(z.string()),
  unchangedReason: z.literal("pinned_definition_status_unavailable").optional(),
});
export type ProgramMemberMutationResult = z.infer<typeof programMemberMutationResultSchema>;
export const programBindingSchema = z.object({
  projectId: z.string().min(1),
  definitionVersion: z.number().int().positive(),
  statusId: statusIdSchema,
});
export type ProgramBinding = z.infer<typeof programBindingSchema>;
export const programBindingIntentSchema = programBindingSchema.extend({
  definitionVersion: z.number().int().positive().nullable(),
});
export type ProgramBindingIntent = z.infer<typeof programBindingIntentSchema>;
export const programCohortInputSchema = z
  .object({ from: z.iso.datetime(), to: z.iso.datetime(), asOf: z.iso.datetime() })
  .refine((v) => v.from < v.to, "Cohort end must be after start");
export type ProgramCohortInput = z.infer<typeof programCohortInputSchema>;
export const programCohortSchema = programCohortInputSchema.extend({
  members: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1),
  averageTimeToSuccessSeconds: z.number().nonnegative().nullable(),
});
export const programDefinitionVersionSchema = z.object({
  version: z.number().int().positive(),
  definition: projectProgramDefinitionSchema,
  publishedAt: z.iso.datetime(),
  publishedBy: z.string().nullable(),
});
export const projectProgramSchema = z.object({
  projectId: z.string(),
  definition: projectProgramDefinitionSchema,
  rowVersion: z.number().int().positive(),
  publishedVersion: z.number().int().positive().nullable(),
  publishedDefinition: projectProgramDefinitionSchema.nullable(),
  versions: z.array(programDefinitionVersionSchema),
});
export type ProjectProgram = z.infer<typeof projectProgramSchema>;

export const PROJECT_PROGRAM_TEMPLATES: Record<
  "resource_request" | "inquiry" | "event",
  ProjectProgramDefinition
> = {
  resource_request: {
    kind: "resource_request",
    initialStatusId: "requested",
    statuses: [
      { id: "requested", label: "請求完了", success: true, nextStatusIds: ["delivered"] },
      { id: "delivered", label: "提供済み", success: true, nextStatusIds: [] },
    ],
  },
  inquiry: {
    kind: "inquiry",
    initialStatusId: "received",
    statuses: [
      {
        id: "received",
        label: "問い合わせ受付",
        success: false,
        nextStatusIds: ["qualified", "closed"],
      },
      { id: "qualified", label: "商談化", success: true, nextStatusIds: [] },
      { id: "closed", label: "対応終了", success: false, nextStatusIds: [] },
    ],
  },
  event: {
    kind: "event",
    initialStatusId: "invited",
    statuses: [
      { id: "invited", label: "招待", success: false, nextStatusIds: ["registered"] },
      { id: "registered", label: "申込", success: false, nextStatusIds: ["attended", "absent"] },
      { id: "attended", label: "出席", success: true, nextStatusIds: [] },
      { id: "absent", label: "欠席", success: false, nextStatusIds: [] },
    ],
  },
};

/** The definition supplied here is the member's immutable enrollment version. */
export function resolveProgramProgress(
  definition: ProjectProgramDefinition,
  current: { statusId: string; firstSuccessAt: string | null } | null,
  input: {
    statusId?: string | undefined;
    source: ProjectMemberSource;
    mode?: "progress" | "correction" | undefined;
    reason?: string | undefined;
  },
  now: string,
): { statusId: string; firstSuccessAt: string | null } {
  const statusId = input.statusId ?? current?.statusId ?? definition.initialStatusId;
  const target = definition.statuses.find((s) => s.id === statusId);
  if (!target) throw new Error("Unknown status in member definition version");
  if (input.mode === "correction") {
    if (input.source !== "manual") throw new Error("Correction requires manual source");
    if (!input.reason?.trim()) throw new Error("Correction requires reason");
    if (!current) throw new Error("Correction requires an existing member");
    return { statusId, firstSuccessAt: target.success ? (current.firstSuccessAt ?? now) : null };
  }
  if (current && current.statusId !== statusId) {
    const seen = new Set<string>();
    const reachable = (id: string): boolean => {
      if (id === statusId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return (definition.statuses.find((s) => s.id === id)?.nextStatusIds ?? []).some(reachable);
    };
    if (!reachable(current.statusId)) {
      const descendants = (id: string): boolean =>
        id === current.statusId ||
        (definition.statuses.find((s) => s.id === id)?.nextStatusIds ?? []).some(descendants);
      if (input.source === "form" && descendants(statusId)) return current;
      throw new Error("Rewind or branch change requires manual correction");
    }
  }
  return { statusId, firstSuccessAt: current?.firstSuccessAt ?? (target.success ? now : null) };
}
