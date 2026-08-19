import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database";

export interface RuntimeSecrets {
  BETTER_AUTH_SECRET: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  TRACKING_SIGNING_SECRET: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}

export type RuntimeEnv = ServerBindings & RuntimeSecrets;

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
