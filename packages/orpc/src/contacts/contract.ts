import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  contactCreateSchema,
  contactListInputSchema,
  contactListResultSchema,
  contactSchema,
  contactTimelineEventSchema,
  contactUpdateSchema,
} from "@openengage/core/contacts";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { ackSchema, idInput } from "../shared/schemas";

const contactNotFound = {
  CONTACT_NOT_FOUND: { status: 404, message: "連絡先が見つかりません" },
} as const;

const contactCreateCommandSchema = contactCreateSchema.and(
  z.object({
    tagId: z.string().min(1).optional(),
    segmentId: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
  }),
);

export const contactsContract = {
  list: oc
    .route({ method: "GET", path: "/contacts" })
    .errors(workspaceErrors)
    .input(contactListInputSchema)
    .output(contactListResultSchema),
  get: oc
    .route({ method: "GET", path: "/contacts/{id}" })
    .errors({ ...workspaceErrors, ...contactNotFound })
    .input(idInput)
    .output(contactSchema),
  timeline: oc
    .route({ method: "GET", path: "/contacts/{id}/timeline" })
    .errors({ ...workspaceErrors, ...contactNotFound })
    .input(idInput)
    .output(z.array(contactTimelineEventSchema)),
  recordEvent: oc
    .route({ method: "POST", path: "/contacts/{id}/events", successStatus: 202 })
    .errors({
      ...authedErrors,
      ...contactNotFound,
    })
    .input(
      z.object({
        id: z.string().min(1),
        eventName: z.string().trim().min(1).max(120),
        source: z.enum(["api", "webhook"]).default("api"),
        properties: z.record(z.string(), z.unknown()).default({}),
        occurredAt: z.iso.datetime().optional(),
      }),
    )
    .output(z.object({ eventId: z.string(), enrollmentCount: z.number().int().nonnegative() })),
  create: oc
    .route({ method: "POST", path: "/contacts", successStatus: 201 })
    .errors({
      ...authedErrors,
      CONTACT_CONFLICT: {
        status: 409,
        message: "同じメールアドレスまたは外部IDの連絡先が既に存在します",
      },
      CONTACT_RELATION_INVALID: {
        status: 422,
        message: "指定された連絡先の関連先が無効です",
        data: z.object({ field: z.enum(["tagId", "segmentId", "companyId"]) }),
      },
    })
    .input(contactCreateCommandSchema)
    .output(contactSchema),
  update: oc
    .route({ method: "PATCH", path: "/contacts/{id}" })
    .errors({
      ...authedErrors,
      CONTACT_NOT_FOUND: { status: 404, message: "連絡先が見つかりません" },
      CONTACT_ARCHIVED: {
        status: 409,
        message: "アーカイブ済みの連絡先は編集できません",
      },
    })
    .input(contactUpdateSchema.extend({ id: z.string().min(1) }))
    .output(contactSchema),
  archive: oc
    .route({ method: "POST", path: "/contacts/{id}/archive" })
    .errors({
      ...authedErrors,
      CONTACT_NOT_FOUND: { status: 404, message: "連絡先が見つかりません" },
    })
    .input(idInput)
    .output(ackSchema),
};
