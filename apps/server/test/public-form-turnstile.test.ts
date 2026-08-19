import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { contract } from "@openengage/orpc";

import { app } from "../src/app";
import type { RuntimeEnv } from "../src/env";
import { seedWorkspace } from "./factory";

type Client = ContractRouterClient<typeof contract>;

afterEach(() => vi.restoreAllMocks());

function bindings(overrides: Partial<RuntimeEnv>): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return Reflect.get(overrides, property, receiver);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RuntimeEnv;
}

function appCall(
  path: string,
  runtime: RuntimeEnv,
  init?: RequestInit,
): Promise<Response> | Response {
  return app.fetch(
    new Request(`http://localhost:8787${path}`, init),
    runtime,
    createExecutionContext(),
  );
}

function clientFor(token: string, runtime: RuntimeEnv): Client {
  return createORPCClient(
    new RPCLink({
      url: "http://localhost:8787/api/rpc",
      headers: { authorization: `Bearer ${token}` },
      fetch: (request) => app.fetch(request, runtime, createExecutionContext()),
    }),
  );
}

async function seedTurnstileForm(): Promise<{
  path: string;
  token: string;
  workspaceSlug: string;
}> {
  const fixture = await seedWorkspace(env.DB);
  const configuredClient = clientFor(
    fixture.token,
    bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: "secret-test" }),
  );
  await configuredClient.website.createForm({
    name: "Protected form",
    slug: "protected",
    status: "published",
    definition: {
      fields: [
        { key: "email", type: "email", required: true },
        { key: "firstName", type: "text" },
      ],
    },
    allowedDomains: [],
    turnstileEnabled: true,
    successMessage: "Thanks",
  });
  return {
    path: `/f/${fixture.slug}/protected`,
    token: fixture.token,
    workspaceSlug: fixture.slug,
  };
}

describe("public form Turnstile", () => {
  it("catches an idempotent replay consuming the single-use token or revalidating its changed body", async () => {
    const form = await seedTurnstileForm();
    const runtime = bindings({
      TURNSTILE_SITE_KEY: "site-test",
      TURNSTILE_SECRET: "secret-test",
    });
    const idempotencyKey = crypto.randomUUID();
    const verificationKeys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = init?.body;
      if (!(body instanceof FormData)) throw new Error("Siteverify must receive FormData");
      const verificationKey = body.get("idempotency_key");
      if (typeof verificationKey !== "string") throw new Error("Siteverify key is missing");
      verificationKeys.push(verificationKey);
      return Response.json({ success: verificationKeys.length === 1 });
    });

    const accepted = await appCall(form.path, runtime, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "replay@example.com",
        firstName: "Original",
        "cf-turnstile-response": "single-use-token",
        idempotencyKey,
      }),
    });
    expect(accepted.status).toBe(202);

    const replay = await appCall(form.path, runtime, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Mutated",
        "cf-turnstile-response": "single-use-token",
        idempotencyKey,
      }),
    });
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual({ data: { accepted: true, duplicate: true } });
    expect(verificationKeys).toEqual([idempotencyKey]);

    const contact = await env.DB.prepare(
      "SELECT email, first_name AS firstName FROM contacts WHERE email = 'replay@example.com'",
    ).first<{ email: string; firstName: string }>();
    expect(contact).toEqual({ email: "replay@example.com", firstName: "Original" });
  });

  it("catches hosted GET/POST accepting an enabled form with incomplete configuration", async () => {
    const form = await seedTurnstileForm();
    const siteKeyOnly = bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: undefined });

    const hosted = await appCall(form.path, siteKeyOnly);
    expect(hosted.status).toBe(503);

    const submitted = await appCall(form.path, siteKeyOnly, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "incomplete@example.com",
        "cf-turnstile-response": "browser-token",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(submitted.status).toBe(503);
  });

  it("catches omitting the Cloudflare widget, script, and CSP sources", async () => {
    const form = await seedTurnstileForm();
    const response = await appCall(
      form.path,
      bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: "secret-test" }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('class="cf-turnstile"');
    expect(html).toContain('data-sitekey="site-test"');
    expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(response.headers.get("content-security-policy")).toContain(
      "https://challenges.cloudflare.com",
    );
  });

  it("catches ignoring the standard cf-turnstile-response token name", async () => {
    const form = await seedTurnstileForm();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true }));

    const response = await appCall(
      form.path,
      bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: "secret-test" }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "standard-token@example.com",
          "cf-turnstile-response": "standard-token",
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    );
    expect(response.status).toBe(202);
  });

  it("catches removing legacy turnstileToken compatibility", async () => {
    const form = await seedTurnstileForm();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true }));

    const response = await appCall(
      form.path,
      bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: "secret-test" }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "legacy-token@example.com",
          turnstileToken: "legacy-token",
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    );
    expect(response.status).toBe(202);
  });

  it("catches publishing or enabling Turnstile from admin with incomplete configuration", async () => {
    const fixture = await seedWorkspace(env.DB);
    const client = clientFor(
      fixture.token,
      bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: undefined }),
    );

    await expect(
      client.website.createForm({
        name: "Cannot publish",
        slug: "cannot-publish",
        status: "published",
        definition: { fields: [{ key: "email", type: "email", required: true }] },
        allowedDomains: [],
        turnstileEnabled: true,
        successMessage: "Thanks",
      }),
    ).rejects.toMatchObject({ code: "TURNSTILE_NOT_CONFIGURED", status: 422 });
  });
});
