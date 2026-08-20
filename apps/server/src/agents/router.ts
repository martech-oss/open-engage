import { AgentConversationRepository } from "@openengage/database/agents";

import { sessionAuthed } from "../orpc/base";

export const createAgentConversationProcedure = sessionAuthed.agents.conversations.create.handler(
  async ({ context, input }) =>
    new AgentConversationRepository(context.database).create({
      workspaceId: context.workspace.workspaceId,
      ownerUserId: context.workspace.userId,
      agentKey: input.agent,
    }),
);

export const listAgentConversationsProcedure = sessionAuthed.agents.conversations.list.handler(
  async ({ context, input }) =>
    new AgentConversationRepository(context.database).list({
      workspaceId: context.workspace.workspaceId,
      ownerUserId: context.workspace.userId,
      ...(input?.agent ? { agentKey: input.agent } : {}),
    }),
);

export const agentProcedures = {
  conversations: {
    create: createAgentConversationProcedure,
    list: listAgentConversationsProcedure,
  },
};
