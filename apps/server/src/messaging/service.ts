import type {
  EmailSegmentOption,
  MessageVariable,
  MessageVariableWrite,
  SubscriptionTopicOption,
} from "@openengage/core/messaging";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { ConsentRepository } from "@openengage/database/consent";
import { MessagingRepository } from "@openengage/database/messaging";
import { SegmentRepository } from "@openengage/database/segments";
import { isConstraintError } from "@openengage/database/shared";

export function listMessageVariables(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<MessageVariable[]> {
  return new MessagingRepository(database, workspace).listMessageVariables(archived);
}

export class VariableConflictError extends Error {
  public override readonly name = "VariableConflictError";
}

export async function createMessageVariable(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: MessageVariableWrite,
): Promise<{ id: string }> {
  try {
    return await new MessagingRepository(database, workspace).createMessageVariable(input);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new VariableConflictError();
  }
}

export async function updateMessageVariable(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: MessageVariableWrite,
): Promise<boolean> {
  try {
    return await new MessagingRepository(database, workspace).updateMessageVariable(id, input);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new VariableConflictError();
  }
}

export function archiveMessageVariable(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new MessagingRepository(database, workspace).archiveMessageVariable(id);
}

export async function listEmailSegmentOptions(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<EmailSegmentOption[]> {
  const rows = await new SegmentRepository(database, workspace).listSegments();
  return rows.map((row) => ({ id: row.id, name: row.name, memberCount: row.memberCount }));
}

export async function listSubscriptionTopicOptions(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<SubscriptionTopicOption[]> {
  const rows = await new ConsentRepository(database, workspace).listTopics();
  return rows.map((row) => ({ id: row.id, name: row.name, isDefault: row.isDefault }));
}
