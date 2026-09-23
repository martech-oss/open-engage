import { oc } from "@orpc/contract";
import * as z from "zod";

import { contactSchema } from "@openengage/core/contacts";
import { projectBriefReferenceSchema } from "@openengage/core/projects";
import {
  generateSegmentInputSchema,
  segmentDefinitionSchema,
  segmentFilterSchema,
  segmentGenerationCatalogSchema,
  segmentGenerationResultSchema,
  segmentRowSchema,
  segmentValidationResultSchema,
} from "@openengage/core/segments";
import { normalizeSlug } from "@openengage/core/shared";

import {
  aiGenerationErrors,
  authedErrors,
  briefContextErrors,
  workspaceErrors,
} from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";

export const segmentsContract = {
  list: oc
    .route({ method: "GET", path: "/segments" })
    .errors(workspaceErrors)
    .input(
      z
        .object({
          kind: z.enum(["static", "dynamic"]).optional(),
        })
        .default({}),
    )
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
    .input(idInput)
    .output(segmentRowSchema),
  create: oc
    .route({ method: "POST", path: "/segments", successStatus: 201 })
    .errors({
      ...authedErrors,
      FILTER_REQUIRED: { status: 422, message: "動的セグメントには条件が必要です" },
      SEGMENT_CONFLICT: { status: 409, message: "同じslugのセグメントが既に存在します" },
      INVALID_SEGMENT_FILTER: { status: 422, message: "セグメント条件が無効です" },
      ...briefContextErrors,
    })
    .input(
      z
        .object({
          name: z.string().trim().min(1).max(191),
          slug: z
            .string()
            .trim()
            .min(1)
            .max(191)
            .transform((value) => normalizeSlug(value, { fallback: "segment" }))
            .optional(),
          description: z.string().trim().max(1_000).default(""),
          kind: z.enum(["static", "dynamic"]),
          filter: segmentFilterSchema.optional(),
          membershipSource: z.string().trim().min(1).max(500).nullable().optional(),
        })
        .and(projectBriefReferenceSchema),
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
      ...aiGenerationErrors("AIが有効なセグメントを生成できませんでした"),
      ...briefContextErrors,
    })
    .input(generateSegmentInputSchema)
    .output(segmentGenerationResultSchema),
  refresh: oc
    .route({ method: "POST", path: "/segments/{id}/refresh" })
    .errors({
      ...authedErrors,
      SEGMENT_NOT_FOUND: { status: 404, message: "セグメントが見つかりません" },
    })
    .input(idInput)
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
