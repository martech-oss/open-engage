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
  const requireEmailVerification = isEmailVerificationRequired(env.ENVIRONMENT);
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
      useSecureCookies: env.ENVIRONMENT !== "development",
      cookiePrefix: "openengage",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.ENVIRONMENT !== "development",
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
      enabled: env.ENVIRONMENT !== "development",
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

export function isEmailVerificationRequired(environment: string): boolean {
  return environment !== "development";
}

export function resolveAuthBaseURL(
  env: Pick<RuntimeEnv, "APP_URL" | "ENVIRONMENT">,
  requestOrigin?: string,
): string {
  if (env.ENVIRONMENT !== "development" || !requestOrigin) return env.APP_URL;
  try {
    const origin = new URL(requestOrigin);
    const hostname = origin.hostname.toLowerCase();
    if (
      origin.protocol === "http:" &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
    ) {
      return origin.origin;
    }
  } catch {
    // Fall back to the configured URL when the request origin is malformed.
  }
  return env.APP_URL;
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
