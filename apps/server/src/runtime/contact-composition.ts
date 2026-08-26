import { ContactResourceRepository } from "@openengage/database/contacts";
import { writeAuditLog } from "@openengage/database/platform";

import {
  ContactCommandService,
  createContactCommandPersistence,
} from "../contacts/command-service";
import {
  createContactResourceProcedures,
  type ContactResourceRouterDependencies,
} from "../contacts/resource-router";
import { addContactSegment as addContactSegmentUseCase } from "../contacts/resource-service";
import { createContactProcedures, type ContactRouterDependencies } from "../contacts/router";
import { recordContactApiEvent as recordContactApiEventUseCase } from "../contacts/service";
import { updateSegmentMemberCount } from "../segments/membership-service";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import { processPendingPublicFormEvent, recordContactEvent } from "./contact-event-service";

const createContactCommandService: ContactRouterDependencies["createCommandService"] = (input) =>
  new ContactCommandService({
    persistence: createContactCommandPersistence(input.database, input.workspace),
    processCreatedEvent: async (eventId) => {
      await processPendingPublicFormEvent(input.database, eventId, input.queue);
    },
    reconcileContact: (contactId) =>
      enqueueSegmentContactReconciliation(input.queue, input.workspace.workspaceId, [contactId]),
    writeAudit: (audit) => writeAuditLog(input.database, input.workspace, audit),
    defer: (promise) => input.defer(promise),
  });

const recordContactApiEvent: ContactRouterDependencies["recordContactApiEvent"] = async (input) => {
  const repository = new ContactResourceRepository(input.database, {
    workspaceId: input.workspaceId,
  });
  return recordContactApiEventUseCase(input.workspaceId, input.event, {
    findActiveContactId: (contactId) => repository.findActiveContactId(contactId),
    recordEvent: (event) =>
      recordContactEvent(input.database, {
        ...event,
        queue: input.queue,
      }),
  });
};

const contactRouterDependencies = {
  createCommandService: createContactCommandService,
  recordContactApiEvent,
} satisfies ContactRouterDependencies;

const addContactSegment: ContactResourceRouterDependencies["addContactSegment"] = async (input) => {
  const repository = new ContactResourceRepository(input.database, input.workspace);
  return addContactSegmentUseCase(input.relation, {
    addMembership: (contactId, segmentId) => repository.addContactSegment(contactId, segmentId),
    updateMemberCount: (segmentId) =>
      updateSegmentMemberCount(input.database, input.workspace.workspaceId, segmentId),
    recordJoined: async ({ contactId, segmentId }) => {
      await recordContactEvent(input.database, {
        workspaceId: input.workspace.workspaceId,
        contactId,
        type: "segment_joined",
        resourceType: "segment",
        resourceId: segmentId,
        queue: input.queue,
      });
    },
  });
};

const contactResourceRouterDependencies = {
  addContactSegment,
} satisfies ContactResourceRouterDependencies;

export const contactProcedures = createContactProcedures(contactRouterDependencies);
export const contactResourceProcedures = createContactResourceProcedures(
  contactResourceRouterDependencies,
);
