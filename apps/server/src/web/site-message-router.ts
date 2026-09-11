import { siteMessageScheduleSchema } from "@openengage/core/web";
import { SiteMessageRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";

export const listMessagesProcedure = authed.website.listMessages.handler(({ context }) =>
  new SiteMessageRepository(context.database, context.workspace).listSiteMessages(),
);

export const createMessageProcedure = authed.website.createMessage.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!siteMessageScheduleSchema.safeParse(input).success) {
      throw errors.SITE_MESSAGE_SCHEDULE_INVALID();
    }
    return new SiteMessageRepository(context.database, context.workspace).createSiteMessage(input);
  },
);

export const updateMessageProcedure = authed.website.updateMessage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!siteMessageScheduleSchema.safeParse(input).success) {
      throw errors.SITE_MESSAGE_SCHEDULE_INVALID();
    }
    const { id, ...changes } = input;
    const repository = new SiteMessageRepository(context.database, context.workspace);
    if (!(await repository.updateSiteMessage(id, changes))) {
      throw errors.SITE_MESSAGE_NOT_FOUND();
    }
    return { id };
  },
);

export const archiveMessageProcedure = authed.website.archiveMessage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new SiteMessageRepository(context.database, context.workspace);
    if (!(await repository.archiveSiteMessage(input.id))) {
      throw errors.SITE_MESSAGE_NOT_FOUND();
    }
    return ack;
  },
);

export const siteMessageProcedures = {
  listMessages: listMessagesProcedure,
  createMessage: createMessageProcedure,
  updateMessage: updateMessageProcedure,
  archiveMessage: archiveMessageProcedure,
};
