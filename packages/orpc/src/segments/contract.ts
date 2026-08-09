import { oc } from "@orpc/contract";
import * as z from "zod";

import { contactSchema } from "@openengage/core/contacts";
import {
  generateSegmentInputSchema,
  segmentDefinitionSchema,
  segmentFilterSchema,
  segmentGenerationCatalogSchema,
  segmentGenerationResultSchema,
  segmentRowSchema,
  segmentValidationResultSchema,
} from "@openengage/core/segments";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema } from "../shared/schemas";

export const segmentsContract = {
  list: oc
    .route({ method: "GET", path: "/segments" })
    .errors(workspaceErrors)
    .output(z.array(segmentRowSchema)),
  options: oc
    .route({ method: "GET", path: "/segments/options" })
    .errors(workspaceErrors)
    .output(segmentGenerationCatalogSchema),
  get: oc
    .route({ method: "GET", path: "/segments/{id}" })
    .errors({
      ...workspaceErrors,
      SEGMENT_NOT_FOUND: { status: 404, message: "セグメントが見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(segmentRowSchema),
  create: oc
    .route({ method: "POST", path: "/segments", successStatus: 201 })
    .errors({
      ...authedErrors,
      FILTER_REQUIRED: { status: 422, message: "動的セグメントには条件が必要です" },
      SEGMENT_CONFLICT: { status: 409, message: "同じslugのセグメントが既に存在します" },
      INVALID_SEGMENT_FILTER: { status: 422, message: "セグメント条件が無効です" },
    })
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().trim().max(1_000).default(""),
        kind: z.enum(["static", "dynamic"]),
        filter: segmentFilterSchema.optional(),
        membershipSource: z.string().trim().min(1).max(500).nullable().optional(),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        kind: z.enum(["static", "dynamic"]),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
  update: oc
    .route({ method: "PATCH", path: "/segments/{id}" })
    .errors({
      ...authedErrors,
      SEGMENT_NOT_FOUND: { status: 404, message: "セグメントが見つかりません" },
      SEGMENT_CONFLICT: { status: 409, message: "同じslugのセグメントが既に存在します" },
      INVALID_SEGMENT_FILTER: { status: 422, message: "セグメント条件が無効です" },
    })
    .input(segmentDefinitionSchema.extend({ id: z.string().min(1) }))
    .output(z.object({ filterVersion: z.number().int().positive() })),
  validate: oc
    .route({ method: "POST", path: "/segments/validate" })
    .errors(authedErrors)
    .input(z.object({ filter: z.unknown() }))
    .output(segmentValidationResultSchema),
  generate: oc
    .route({ method: "POST", path: "/segments/generate" })
    .errors({
      ...authedErrors,
      AI_GENERATION_FAILED: { status: 502, message: "AIが有効なセグメントを生成できませんでした" },
      AI_GENERATION_UNAVAILABLE: { status: 503, message: "AI生成を現在利用できません" },
      AI_GENERATION_TIMEOUT: { status: 504, message: "AI生成がタイムアウトしました" },
    })
    .input(generateSegmentInputSchema)
    .output(segmentGenerationResultSchema),
  refresh: oc
    .route({ method: "POST", path: "/segments/{id}/refresh" })
    .errors({
      ...authedErrors,
      SEGMENT_NOT_FOUND: { status: 404, message: "セグメントが見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(ackSchema),
  preview: oc
    .route({ method: "POST", path: "/segments/preview" })
    .errors({
      ...authedErrors,
      INVALID_SEGMENT_FILTER: { status: 422, message: "セグメント条件が無効です" },
    })
    .input(z.object({ filter: segmentFilterSchema }))
    .output(
      z.object({
        contacts: z.array(contactSchema),
        capped: z.boolean(),
        matchedCount: z.number().int().nonnegative(),
        normalizedFilter: segmentFilterSchema,
        warnings: z.array(z.string()),
      }),
    ),
};
