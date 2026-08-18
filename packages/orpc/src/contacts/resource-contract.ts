import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  contactBulkActionSchema,
  contactOptionsSchema,
  contactProfileSchema,
  contactSchema,
  contactScoreAdjustSchema,
  tagCreateSchema,
  tagSchema,
  tagUpdateSchema,
} from "@openengage/core/contacts";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema } from "../shared/schemas";

const contactNotFound = {
  CONTACT_NOT_FOUND: {
    status: 404,
    message: "連絡先が見つかりません",
  },
} as const;

/** Adding or removing a relation fails with 409 when the pairing is not allowed. */
function relationErrors(message: string) {
  return {
    ...authedErrors,
    RELATION_REJECTED: { status: 409, message },
  } as const;
}

const contactRelationInput = z.object({
  contactId: z.string().min(1),
  resourceId: z.string().min(1),
});

export const contactResourcesContract = {
  options: oc
    .route({ method: "GET", path: "/contacts/options" })
    .errors(workspaceErrors)
    .output(contactOptionsSchema),
  profile: oc
    .route({ method: "GET", path: "/contacts/{contactId}/profile" })
    .errors({ ...workspaceErrors, ...contactNotFound })
    .input(z.object({ contactId: z.string().min(1) }))
    .output(contactProfileSchema),
  createTag: oc
    .route({ method: "POST", path: "/contacts/tags", successStatus: 201 })
    .errors({
      ...authedErrors,
      TAG_CONFLICT: { status: 409, message: "同名のタグが既に存在します" },
    })
    .input(tagCreateSchema)
    .output(tagSchema.omit({ contactCount: true })),
  updateTag: oc
    .route({ method: "PATCH", path: "/contacts/tags/{id}" })
    .errors({
      ...authedErrors,
      TAG_NOT_FOUND: { status: 404, message: "タグが見つかりません" },
      TAG_CONFLICT: { status: 409, message: "同名のタグが既に存在します" },
    })
    .input(tagUpdateSchema)
    .output(tagSchema.omit({ contactCount: true })),
  assignTag: oc
    .route({ method: "POST", path: "/contacts/{contactId}/tags", successStatus: 201 })
    .errors(relationErrors("タグを追加できませんでした"))
    .input(contactRelationInput)
    .output(ackSchema),
  removeTag: oc
    .route({ method: "DELETE", path: "/contacts/{contactId}/tags/{resourceId}" })
    .errors(relationErrors("タグを削除できませんでした"))
    .input(contactRelationInput)
    .output(ackSchema),
  addToSegment: oc
    .route({ method: "POST", path: "/contacts/{contactId}/segments", successStatus: 201 })
    .errors(relationErrors("リストへ追加できませんでした"))
    .input(contactRelationInput)
    .output(ackSchema),
  removeFromSegment: oc
    .route({ method: "DELETE", path: "/contacts/{contactId}/segments/{resourceId}" })
    .errors(authedErrors)
    .input(contactRelationInput)
    .output(ackSchema),
  adjustScore: oc
    .route({ method: "POST", path: "/contacts/{contactId}/score" })
    .errors({
      ...authedErrors,
      SCORE_NOT_ADJUSTABLE: { status: 409, message: "スコアを変更できませんでした" },
    })
    .input(contactScoreAdjustSchema.extend({ contactId: z.string().min(1) }))
    .output(contactSchema),
  restore: oc
    .route({ method: "POST", path: "/contacts/{id}/restore" })
    .errors({
      ...authedErrors,
      CONTACT_NOT_ARCHIVED: { status: 404, message: "復元できる連絡先が見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(ackSchema),
  bulkUpdate: oc
    .route({ method: "POST", path: "/contacts/bulk-update" })
    .errors({
      ...authedErrors,
      ARCHIVE_FORBIDDEN: { status: 403, message: "アーカイブ操作にはAdmin権限が必要です" },
      RESOURCE_REQUIRED: { status: 422, message: "対象を選択してください" },
    })
    .input(contactBulkActionSchema)
    .output(z.object({ updated: z.number().int().nonnegative() })),
};
