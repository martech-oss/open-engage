import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { ack, CSV_MAX_BYTES } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import type { ContactCommandService } from "./command-service";
import {
  getContactExportFile,
  getDataJob,
  startContactExport,
  startContactImport,
} from "./import-export-service";
import { getContact, getContactTimeline, listContacts } from "./service";
import type { ContactApiEventInput, ContactEventOutcome } from "./service";

export interface ContactRouterDependencies {
  createCommandService(input: {
    database: OpenEngageDatabase;
    workspace: WorkspaceContext;
    queue: Queue;
    defer(promise: Promise<unknown>): void;
  }): ContactCommandService;
  recordContactApiEvent(input: {
    database: OpenEngageDatabase;
    workspaceId: string;
    event: ContactApiEventInput;
    queue: Queue;
  }): Promise<ContactEventOutcome>;
}

export const listContactsProcedure = authed.contacts.list.handler(async ({ context, input }) =>
  listContacts(context.database, context.workspace, input),
);

export const getContactProcedure = authed.contacts.get.handler(
  async ({ context, input, errors }) => {
    const contact = await getContact(context.database, context.workspace, input.id);
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

function createRecordContactEventProcedure(dependencies: ContactRouterDependencies) {
  return authed.contacts.recordEvent.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await dependencies.recordContactApiEvent({
      database: context.database,
      workspaceId: context.workspace.workspaceId,
      event: {
        contactId: input.id,
        eventName: input.eventName,
        source: input.source,
        properties: input.properties,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
      queue: context.env.JOBS_QUEUE,
    });
    if (outcome.kind === "contact_not_found") throw errors.CONTACT_NOT_FOUND();
    return { eventId: outcome.eventId, enrollmentCount: outcome.enrollmentCount };
  });
}

function createCreateContactProcedure(dependencies: ContactRouterDependencies) {
  return authed.contacts.create.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await dependencies
      .createCommandService({
        database: context.database,
        workspace: context.workspace,
        queue: context.env.JOBS_QUEUE,
        defer: (promise) => context.executionContext.waitUntil(promise),
      })
      .create(input);
    if (outcome.kind === "contact_relation_invalid") {
      throw errors.CONTACT_RELATION_INVALID({
        data: { field: outcome.field },
        cause: outcome.cause,
      });
    }
    if (outcome.kind === "contact_conflict") {
      throw errors.CONTACT_CONFLICT({ cause: outcome.cause });
    }
    return outcome.contact;
  });
}

function createUpdateContactProcedure(dependencies: ContactRouterDependencies) {
  return authed.contacts.update.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await dependencies
      .createCommandService({
        database: context.database,
        workspace: context.workspace,
        queue: context.env.JOBS_QUEUE,
        defer: (promise) => context.executionContext.waitUntil(promise),
      })
      .update(input);
    if (outcome.kind === "contact_not_found") throw errors.CONTACT_NOT_FOUND();
    if (outcome.kind === "contact_archived") throw errors.CONTACT_ARCHIVED();
    return outcome.contact;
  });
}

function createArchiveContactProcedure(dependencies: ContactRouterDependencies) {
  return authed.contacts.archive.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await dependencies
      .createCommandService({
        database: context.database,
        workspace: context.workspace,
        queue: context.env.JOBS_QUEUE,
        defer: (promise) => context.executionContext.waitUntil(promise),
      })
      .archive(input.id);
    if (outcome.kind === "contact_not_found") throw errors.CONTACT_NOT_FOUND();
    return ack;
  });
}

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
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return startContactExport(context.database, context.env.JOBS_QUEUE, context.workspace, input);
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

export function createContactProcedures(dependencies: ContactRouterDependencies) {
  return {
    list: listContactsProcedure,
    get: getContactProcedure,
    timeline: contactTimelineProcedure,
    recordEvent: createRecordContactEventProcedure(dependencies),
    create: createCreateContactProcedure(dependencies),
    update: createUpdateContactProcedure(dependencies),
    archive: createArchiveContactProcedure(dependencies),
    startImport: importContactsProcedure,
    startExport: exportContactsProcedure,
    getDataJob: getDataJobProcedure,
    downloadExport: downloadContactExportProcedure,
  };
}
