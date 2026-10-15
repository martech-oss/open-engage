import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { organization, twoFactor } from "better-auth/plugins";
import { adminAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";

import { createDatabase } from "@openengage/database/client";
import { authSchema } from "@openengage/database/schema";

import type { RuntimeEnv } from "../env";
import { CloudflareEmailAdapter } from "../messaging/cloudflare-email";
import { bytesToHex } from "../platform/crypto";
import { renderSystemEmail, type SystemEmailInput } from "./email-templates";

export function createAuth(env: RuntimeEnv, requestOrigin?: string) {
  const database = createDatabase(env.DB).orm;
  const baseURL = resolveAuthBaseURL(env, requestOrigin);
  const localDevelopment = isLocalDevelopment(env);
  const requireEmailVerification = isEmailVerificationRequired(env);
  return betterAuth({
    appName: env.APP_NAME,
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: authSchema,
      usePlural: false,
    }),
    trustedOrigins: [...new Set([env.APP_URL, baseURL])],
    advanced: {
      useSecureCookies: !localDevelopment,
      cookiePrefix: "openengage",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: !localDevelopment,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      minPasswordLength: 12,
      async sendResetPassword({ user, url }) {
        await sendAuthEmail(env, {
          kind: "password-reset",
          to: user.email,
          appName: env.APP_NAME,
          actionUrl: url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await sendAuthEmail(env, {
          kind: "email-verification",
          to: user.email,
          appName: env.APP_NAME,
          actionUrl: url,
        });
      },
    },
    plugins: [
      twoFactor({
        issuer: env.APP_NAME,
      }),
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 25,
        creatorRole: "owner",
        roles: {
          owner: ownerAc,
          admin: adminAc,
          marketer: memberAc,
          analyst: memberAc,
          viewer: memberAc,
        },
        requireEmailVerificationOnInvitation: true,
        async sendInvitationEmail(data) {
          const url = `${baseURL}/accept-invitation?id=${encodeURIComponent(data.id)}`;
          await sendAuthEmail(env, {
            kind: "organization-invitation",
            to: data.email,
            appName: env.APP_NAME,
            actionUrl: url,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
          });
        },
      }),
    ],
    rateLimit: {
      enabled: !localDevelopment,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 300, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
  });
}

export function isEmailVerificationRequired(
  env: Pick<RuntimeEnv, "APP_URL" | "ENVIRONMENT">,
): boolean {
  return !isLocalDevelopment(env);
}

/**
 * Development relaxes email verification, auth rate limits and secure
 * cookies. A deployed Worker that still carries `ENVIRONMENT: "development"`
 * serves a public APP_URL, so the relaxations stay tied to a loopback one.
 */
export function isLocalDevelopment(env: Pick<RuntimeEnv, "APP_URL" | "ENVIRONMENT">): boolean {
  return env.ENVIRONMENT === "development" && isLoopbackHttpUrl(env.APP_URL);
}

function isLoopbackHttpUrl(value: string): boolean {
  const url = URL.parse(value);
  const hostname = url?.hostname.toLowerCase();
  return (
    url?.protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
  );
}

export function resolveAuthBaseURL(
  env: Pick<RuntimeEnv, "APP_URL" | "ENVIRONMENT">,
  requestOrigin?: string,
): string {
  if (!isLocalDevelopment(env) || !requestOrigin) return env.APP_URL;
  // Fall back to the configured URL when the request origin is malformed or remote.
  return isLoopbackHttpUrl(requestOrigin) ? new URL(requestOrigin).origin : env.APP_URL;
}

async function sendAuthEmail(
  env: RuntimeEnv,
  input: SystemEmailInput & { to: string },
): Promise<void> {
  const { to, ...templateInput } = input;
  const rendered = await renderSystemEmail(templateInput);
  const adapter = new CloudflareEmailAdapter(env.EMAIL);
  await adapter.send({
    kind: "email",
    idempotencyKey: `auth:${input.kind}:${await authEmailKey(to, rendered.subject)}`,
    purpose: "transactional",
    to,
    from: {
      email: env.TRANSACTIONAL_FROM_EMAIL,
      name: env.TRANSACTIONAL_FROM_NAME,
    },
    ...rendered,
  });
}

async function authEmailKey(recipient: string, subject: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([recipient, subject])),
  );
  return bytesToHex(digest.slice(0, 16));
}
