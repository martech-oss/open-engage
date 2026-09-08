import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  campaignCostInputSchema,
  campaignCostSchema,
  generateMarketingBriefInputSchema,
  marketingBriefGenerationResultSchema,
  projectBriefDetailSchema,
  projectBriefDraftInputSchema,
  projectBriefSummarySchema,
  projectMemberOptionSchema,
  projectResourceTypeSchema,
  projectRowSchema,
} from "@openengage/core/projects";

import {
  authedErrors,
  projectBriefMemberError,
  projectBriefNotFoundError,
  projectBriefStateErrors,
  workspaceErrors,
} from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";

const expectedRowVersionInput = {
  expectedRowVersion: z.number().int().positive().optional(),
} as const;

const briefIdInput = idInput.extend(expectedRowVersionInput);

const costErrors = {
  ...authedErrors,
  PROJECT_NOT_FOUND: { status: 404, message: "Projectまたは費用が見つかりません" },
  COST_CONFLICT: { status: 409, message: "同じ費用IDで異なる内容は登録できません" },
};
const costIdInput = idInput.extend({ costId: z.uuid() });

export const projectsContract = {
  listCosts: oc
    .route({ method: "GET", path: "/projects/{id}/costs" })
    .errors(costErrors)
    .input(idInput)
    .output(z.array(campaignCostSchema)),
  createCost: oc
    .route({ method: "POST", path: "/projects/{id}/costs", successStatus: 201 })
    .errors(costErrors)
    .input(campaignCostInputSchema.extend(costIdInput.shape))
    .output(ackSchema),
  updateCost: oc
    .route({ method: "PUT", path: "/projects/{id}/costs/{costId}" })
    .errors(costErrors)
    .input(campaignCostInputSchema.extend(costIdInput.shape))
    .output(ackSchema),
  deleteCost: oc
    .route({ method: "DELETE", path: "/projects/{id}/costs/{costId}" })
    .errors(costErrors)
    .input(costIdInput)
    .output(ackSchema),
  list: oc
    .route({ method: "GET", path: "/projects" })
    .errors(workspaceErrors)
    .output(z.array(projectRowSchema)),
  create: oc
    .route({ method: "POST", path: "/projects", successStatus: 201 })
    .errors(authedErrors)
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        description: z.string().max(2_000).default(""),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#7c3aed"),
      }),
    )
    .output(z.object({ id: z.string() })),
  addItem: oc
    .route({ method: "POST", path: "/projects/{id}/items" })
    .errors({
      ...authedErrors,
      PROJECT_NOT_FOUND: { status: 404, message: "Projectが見つかりません" },
      PROJECT_BRIEF_MANAGED: {
        status: 409,
        message: "施策ブリーフ管理中のProjectにはこの経路でリンクできません",
      },
    })
    .input(
      z.object({
        id: z.string().min(1),
        resourceType: projectResourceTypeSchema,
        resourceId: z.string().min(1),
      }),
    )
    .output(z.object({ added: z.boolean() })),
  briefList: oc
    .route({ method: "GET", path: "/projects/briefs" })
    .errors(workspaceErrors)
    .output(z.array(projectBriefSummarySchema)),
  briefOptions: oc
    .route({ method: "GET", path: "/projects/briefs/options" })
    .errors(workspaceErrors)
    .output(z.object({ members: z.array(projectMemberOptionSchema) })),
  briefGet: oc
    .route({ method: "GET", path: "/projects/{id}/brief" })
    .errors({ ...workspaceErrors, ...projectBriefNotFoundError })
    .input(idInput)
    .output(projectBriefDetailSchema),
  briefCreate: oc
    .route({ method: "POST", path: "/projects/briefs", successStatus: 201 })
    .errors({
      ...authedErrors,
      ...projectBriefMemberError,
    })
    .input(projectBriefDraftInputSchema)
    .output(z.object({ id: z.string() })),
  briefUpdate: oc
    .route({ method: "PATCH", path: "/projects/{id}/brief" })
    .errors({
      ...authedErrors,
      ...projectBriefNotFoundError,
      ...projectBriefStateErrors,
      ...projectBriefMemberError,
    })
    .input(
      projectBriefDraftInputSchema.extend({ id: z.string().min(1), ...expectedRowVersionInput }),
    )
    .output(ackSchema),
  briefGenerate: oc
    .route({ method: "POST", path: "/projects/briefs/generate" })
    .errors({
      ...authedErrors,
      AI_GENERATION_FAILED: {
        status: 502,
        message: "AIが有効な施策ブリーフを生成できませんでした",
      },
      AI_GENERATION_UNAVAILABLE: { status: 503, message: "AI生成を現在利用できません" },
      AI_GENERATION_TIMEOUT: { status: 504, message: "AI生成がタイムアウトしました" },
    })
    .input(generateMarketingBriefInputSchema)
    .output(marketingBriefGenerationResultSchema),
  briefSubmit: oc
    .route({ method: "POST", path: "/projects/{id}/brief/submit" })
    .errors({
      ...authedErrors,
      ...projectBriefNotFoundError,
      ...projectBriefStateErrors,
      ...projectBriefMemberError,
    })
    .input(briefIdInput)
    .output(ackSchema),
  briefApprove: oc
    .route({ method: "POST", path: "/projects/{id}/brief/approve" })
    .errors({ ...authedErrors, ...projectBriefNotFoundError, ...projectBriefStateErrors })
    .input(briefIdInput.extend({ comment: z.string().trim().max(2_000).default("") }))
    .output(ackSchema),
  briefReject: oc
    .route({ method: "POST", path: "/projects/{id}/brief/reject" })
    .errors({ ...authedErrors, ...projectBriefNotFoundError, ...projectBriefStateErrors })
    .input(briefIdInput.extend({ comment: z.string().trim().min(1).max(2_000) }))
    .output(ackSchema),
  briefWithdraw: oc
    .route({ method: "POST", path: "/projects/{id}/brief/withdraw" })
    .errors({ ...authedErrors, ...projectBriefNotFoundError, ...projectBriefStateErrors })
    .input(
      briefIdInput.extend({
        reason: z.string().trim().min(1).max(2_000),
      }),
    )
    .output(ackSchema),
  briefReopen: oc
    .route({ method: "POST", path: "/projects/{id}/brief/reopen" })
    .errors({ ...authedErrors, ...projectBriefNotFoundError, ...projectBriefStateErrors })
    .input(briefIdInput)
    .output(ackSchema),
  briefComplete: oc
    .route({ method: "POST", path: "/projects/{id}/brief/complete" })
    .errors({ ...authedErrors, ...projectBriefNotFoundError, ...projectBriefStateErrors })
    .input(briefIdInput)
    .output(ackSchema),
  briefArchive: oc
    .route({ method: "POST", path: "/projects/{id}/brief/archive" })
    .errors({ ...authedErrors, ...projectBriefNotFoundError, ...projectBriefStateErrors })
    .input(briefIdInput)
    .output(ackSchema),
  briefAddItem: oc
    .route({ method: "POST", path: "/projects/{id}/brief/items" })
    .errors({
      ...authedErrors,
      ...projectBriefNotFoundError,
      ...projectBriefStateErrors,
      PROJECT_RESOURCE_NOT_FOUND: { status: 404, message: "リンク対象が見つかりません" },
    })
    .input(
      idInput.extend({
        resourceType: projectResourceTypeSchema,
        resourceId: z.string().min(1),
        ...expectedRowVersionInput,
      }),
    )
    .output(z.object({ added: z.boolean() })),
  briefRemoveItem: oc
    .route({ method: "DELETE", path: "/projects/{id}/brief/items/{resourceType}/{resourceId}" })
    .errors({ ...authedErrors, ...projectBriefNotFoundError, ...projectBriefStateErrors })
    .input(
      idInput.extend({
        resourceType: projectResourceTypeSchema,
        resourceId: z.string().min(1),
        ...expectedRowVersionInput,
      }),
    )
    .output(ackSchema),
};
