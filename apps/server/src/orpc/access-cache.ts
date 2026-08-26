export interface AccessResolvers<TWorkspace, TSessionWorkspace, TSession> {
  workspace(): Promise<TWorkspace>;
  sessionWorkspace(): Promise<TSessionWorkspace>;
  session(): Promise<TSession>;
}

/** Request-scoped promise cache shared by every procedure in one oRPC batch. */
export function createRequestAccessCache<TWorkspace, TSessionWorkspace, TSession>(
  resolvers: AccessResolvers<TWorkspace, TSessionWorkspace, TSession>,
): AccessResolvers<TWorkspace, TSessionWorkspace, TSession> {
  let workspace: Promise<TWorkspace> | undefined;
  let sessionWorkspace: Promise<TSessionWorkspace> | undefined;
  let session: Promise<TSession> | undefined;

  return {
    workspace: () => (workspace ??= resolvers.workspace()),
    sessionWorkspace: () => (sessionWorkspace ??= resolvers.sessionWorkspace()),
    session: () => (session ??= resolvers.session()),
  };
}
