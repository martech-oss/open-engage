const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Lists what in a Worker config's `vars` would deploy a public server with
 * local-development auth (no email verification, no auth rate limits,
 * non-secure cookies), or with an APP_URL nobody outside can reach.
 */
export function deployConfigProblems(vars) {
  const problems = [];
  if (vars?.ENVIRONMENT === "development")
    problems.push(
      'vars.ENVIRONMENT is "development"; set it to "production" (the setup CLI does this).',
    );
  const appUrl = URL.parse(String(vars?.APP_URL ?? ""));
  // Production cookies are always Secure, so only an HTTPS URL can hold a session;
  // the setup CLI asks for HTTPS for the same reason.
  if (!appUrl || appUrl.protocol !== "https:" || LOOPBACK_HOSTS.has(appUrl.hostname.toLowerCase()))
    problems.push("vars.APP_URL must be the deployed public https:// URL, not a local address.");
  return problems;
}
