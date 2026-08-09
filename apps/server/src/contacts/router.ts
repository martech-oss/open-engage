import { writeAuditLog } from "@openengage/database";
import { ContactRepository } from "@openengage/database";
import { ack, CSV_MAX_BYTES } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import {
  getContactExportFile,
  getDataJob,
  startContactExport,
  startContactImport,
} from "./import-export-service";
import { createContact, getContactTimeline, listContacts, recordContactApiEvent } from "./service";

export const listContactsProcedure = authed.contacts.list.handler(async ({ context, input }) =>
  listContacts(context.database, context.workspace, input),
);

export const getContactProcedure = authed.contacts.get.handler(
  async ({ context, input, errors }) => {
    const repository = new ContactRepository(context.database, context.workspace);
    const contact = await repository.getContact(input.id);
    if (!contact) throw errors.CONTACT_NOT_FOUND();
    return contact;
  },
);

export const contactTimelineProcedure = authed.contacts.timeline.handler(
  async ({ context, input, errors }) => {
    const timeline = await getContactTimeline(
      context.database,
      context.workspace.workspaceId,
      input.id,
    );
    if (!timeline) throw errors.CONTACT_NOT_FOUND();
    return timeline;
  },
);

export const recordContactEventProcedure = authed.contacts.recordEvent.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await recordContactApiEvent(
      context.database,
      context.workspace.workspaceId,
      {
        contactId: input.id,
        eventName: input.eventName,
        source: input.source,
        properties: input.properties,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
      context.env.JOBS_QUEUE,
    );
    if (outcome.kind === "contact_not_found") throw errors.CONTACT_NOT_FOUND();
    return { eventId: outcome.eventId, enrollmentCount: outcome.enrollmentCount };
  },
);

export const createContactProcedure = authed.contacts.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);

    try {
      const contact = await createContact(
        context.database,
        context.workspace,
        input,
        context.env.JOBS_QUEUE,
      );
      context.executionContext.waitUntil(
        writeAuditLog(context.database, context.workspace, {
          action: "contact.create",
          resourceType: "contact",
          resourceId: contact.id,
        }),
      );
      return contact;
    } catch (error) {
      throw errors.CONTACT_CONFLICT({ cause: error });
    }
  },
);

export const updateContactProcedure = authed.contacts.update.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const repository = new ContactRepository(context.database, context.workspace);
    const existing = await repository.getContact(id);
    if (!existing) throw errors.CONTACT_NOT_FOUND();
    if (existing.status === "archived") throw errors.CONTACT_ARCHIVED();
    const contact = await repository.updateContact(id, changes);
    if (!contact) throw errors.CONTACT_NOT_FOUND();
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [id],
    );
    return contact;
  },
);

export const archiveContactProcedure = authed.contacts.archive.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const archived = await new ContactRepository(
      context.database,
      context.workspace,
    ).archiveContact(input.id);
    if (!archived) throw errors.CONTACT_NOT_FOUND();
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [input.id],
    );
    return ack;
  },
);

export const importContactsProcedure = authed.contacts.startImport.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (input.file.size > CSV_MAX_BYTES) throw errors.CSV_TOO_LARGE();
    const csvText = await input.file.text();
    const outcome = await startContactImport(
      context.database,
      { bucket: context.env.ASSETS_BUCKET, queue: context.env.JOBS_QUEUE },
      context.workspace,
      csvText,
    );
    if (outcome.kind === "identifier_missing") throw errors.CSV_IDENTIFIER_MISSING();
    return { jobId: outcome.jobId, rows: outcome.rows, parts: outcome.parts };
  },
);

export const exportContactsProcedure = authed.contacts.startExport.handler(
  async ({ context, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return startContactExport(context.database, context.env.JOBS_QUEUE, context.workspace);
  },
);

export const getDataJobProcedure = authed.contacts.getDataJob.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const job = await getDataJob(context.database, context.workspace.workspaceId, input.id);
    if (!job) throw errors.DATA_JOB_NOT_FOUND();
    return job;
  },
);

export const downloadContactExportProcedure = authed.contacts.downloadExport.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const outcome = await getContactExportFile(
      context.database,
      context.env.ASSETS_BUCKET,
      context.workspace.workspaceId,
      input.id,
    );
    if (outcome.kind === "not_ready") throw errors.EXPORT_NOT_READY();
    if (outcome.kind === "missing") throw errors.EXPORT_MISSING();
    return outcome.file;
  },
);

export const contactProcedures = {
  list: listContactsProcedure,
  get: getContactProcedure,
  timeline: contactTimelineProcedure,
  recordEvent: recordContactEventProcedure,
  create: createContactProcedure,
  update: updateContactProcedure,
  archive: archiveContactProcedure,
  startImport: importContactsProcedure,
  startExport: exportContactsProcedure,
  getDataJob: getDataJobProcedure,
  downloadExport: downloadContactExportProcedure,
};
