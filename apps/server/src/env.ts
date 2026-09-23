import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

import type {
  DeliveryQueueMessage,
  JobsQueueMessage,
  ProgramMemberImportQueueMessage,
} from "./platform/queue-messages";

export interface RuntimeSecrets {
  BETTER_AUTH_SECRET: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  TRACKING_SIGNING_SECRET: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}

/** Queue producers typed by the messages their consumers accept (wrangler types them as unknown). */
interface TypedQueueBindings {
  JOBS_QUEUE: Queue<JobsQueueMessage>;
  DELIVERY_QUEUE: Queue<DeliveryQueueMessage>;
  PROGRAM_MEMBER_IMPORT_QUEUE: Queue<ProgramMemberImportQueueMessage>;
}

export type RuntimeEnv = Omit<ServerBindings, keyof TypedQueueBindings> &
  TypedQueueBindings &
  RuntimeSecrets;

export interface SessionValue {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
  };
  session: {
    id: string;
    userId: string;
    activeOrganizationId?: string | null;
  };
}

export interface AppVariables {
  database: OpenEngageDatabase;
  requestId: string;
  workspace: WorkspaceContext;
  session: SessionValue | null;
}

export type AppEnvironment = {
  Bindings: RuntimeEnv;
  Variables: AppVariables;
};
