import { ConsentRepository } from "@openengage/database/consent";

import { authed, requireRole } from "../orpc/base";

export const listTopicsProcedure = authed.consent.listTopics.handler(({ context }) =>
  new ConsentRepository(context.database, context.workspace).listTopics(),
);

export const createTopicProcedure = authed.consent.createTopic.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await new ConsentRepository(context.database, context.workspace).createTopic(
      input,
    );
    if (outcome.kind === "conflict") throw errors.TOPIC_CONFLICT();
    return { id: outcome.id };
  },
);

export const consentProcedures = {
  listTopics: listTopicsProcedure,
  createTopic: createTopicProcedure,
};
