import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  automationDefinitionSchema,
  automationDraftSchema,
  automationGenerationResultSchema,
  automationRowSchema,
  applyEmailSequenceInputSchema,
  applyEmailSequenceResultSchema,
  emailSequenceGenerationResultSchema,
  generateAutomationInputSchema,
  generateEmailSequenceInputSchema,
} from "@openengage/core/automations";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";

export const automationsContract = {
  list: oc
    .route({ method: "GET", path: "/automations" })
    .errors(workspaceErrors)
    .output(z.array(automationRowSchema)),
  create: oc
    .route({ method: "POST", path: "/automations", successStatus: 201 })
    .errors(authedErrors)
    .input(automationDefinitionSchema)
    .output(z.object({ id: z.string(), draftVersionId: z.string() })),
  generate: oc
    .route({ method: "POST", path: "/automations/generate" })
    .errors({
      ...authedErrors,
      AI_GENERATION_FAILED: { status: 502, message: "AIが有効なフローを生成できませんでした" },
      AI_GENERATION_UNAVAILABLE: { status: 503, message: "AI生成を現在利用できません" },
      AI_GENERATION_TIMEOUT: { status: 504, message: "AI生成がタイムアウトしました" },
    })
    .input(generateAutomationInputSchema)
    .output(automationGenerationResultSchema),
  generateSequence: oc
    .route({ method: "POST", path: "/automations/sequences/generate" })
    .errors({
      ...authedErrors,
      AI_GENERATION_FAILED: { status: 502, message: "AIが有効なシーケンスを生成できませんでした" },
      AI_GENERATION_UNAVAILABLE: { status: 503, message: "AI生成を現在利用できません" },
      AI_GENERATION_TIMEOUT: { status: 504, message: "AI生成がタイムアウトしました" },
    })
    .input(generateEmailSequenceInputSchema)
    .output(emailSequenceGenerationResultSchema),
  applySequence: oc
    .route({ method: "POST", path: "/automations/sequences/apply", successStatus: 201 })
    .errors({
      ...authedErrors,
      INVALID_SEQUENCE: { status: 422, message: "シーケンス提案を適用できません" },
      SEQUENCE_CONFLICT: { status: 409, message: "シーケンスのIDが競合しています" },
    })
    .input(applyEmailSequenceInputSchema)
    .output(applyEmailSequenceResultSchema),
  getDraft: oc
    .route({ method: "GET", path: "/automations/{id}/draft" })
    .errors({
      ...workspaceErrors,
      AUTOMATION_NOT_FOUND: { status: 404, message: "オートメーションが見つかりません" },
    })
    .input(idInput)
    .output(automationDraftSchema),
  saveDraft: oc
    .route({ method: "PUT", path: "/automations/{id}/draft" })
    .errors({
      ...authedErrors,
      // Distinct from "automation not found": the automation exists but has
      // no editable draft, which is what the route reports here.
      DRAFT_NOT_EDITABLE: { status: 404, message: "編集可能な下書きが見つかりません" },
    })
    .input(automationDefinitionSchema.extend({ id: z.string().min(1) }))
    .output(ackSchema),
  publish: oc
    .route({ method: "POST", path: "/automations/{id}/publish" })
    .errors({
      ...authedErrors,
      DRAFT_NOT_FOUND: { status: 404, message: "下書きが見つかりません" },
      // Covers every publish-time rejection: an unpublishable graph, a missing
      // source node, or an email node pointing at an unsynced template. The
      // specific reason is supplied at throw time.
      INVALID_GRAPH: { status: 422, message: "公開できないグラフです" },
    })
    .input(idInput)
    .output(z.object({ publishedVersionId: z.string(), draftVersionId: z.string() })),
  setStatus: oc
    .route({ method: "POST", path: "/automations/{id}/status" })
    .errors({
      ...authedErrors,
      NOT_CHANGEABLE: { status: 409, message: "公開済みフローがありません" },
    })
    .input(z.object({ id: z.string().min(1), status: z.enum(["active", "paused"]) }))
    .output(z.object({ status: z.enum(["active", "paused"]) })),
  enroll: oc
    .route({ method: "POST", path: "/automations/{id}/enroll", successStatus: 202 })
    .errors({
      ...authedErrors,
      AUTOMATION_NOT_ACTIVE: { status: 404, message: "公開中のオートメーションがありません" },
      SOURCE_MISSING: { status: 422, message: "Sourceノードがありません" },
      ALREADY_ENROLLED: { status: 409, message: "このイベントでは既に参加済みです" },
    })
    .input(
      z.object({
        id: z.string().min(1),
        contactId: z.string().min(1),
        sourceEventId: z.string().optional(),
      }),
    )
    .output(z.object({ enrollmentId: z.string(), jobId: z.string() })),
  analytics: oc
    .route({ method: "GET", path: "/automations/{id}/analytics" })
    .errors(workspaceErrors)
    .input(idInput)
    .output(
      z.object({
        enrollments: z.array(
          z.object({ status: z.string(), count: z.number().int().nonnegative() }),
        ),
        deliveries: z.array(
          z.object({ status: z.string(), count: z.number().int().nonnegative() }),
        ),
      }),
    ),
};
