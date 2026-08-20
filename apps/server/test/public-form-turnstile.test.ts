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
  it("catches reusing a provider UUID when a fresh Turnstile token changes the verification request", async () => {
    const form = await seedTurnstileForm();
    const runtime = bindings({
      TURNSTILE_SITE_KEY: "site-test",
      TURNSTILE_SECRET: "secret-test",
    });
    const verificationKeys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = init?.body;
      if (!(body instanceof FormData)) throw new Error("Siteverify must receive FormData");
      const verificationKey = body.get("idempotency_key");
      if (typeof verificationKey !== "string") throw new Error("Siteverify key is missing");
      verificationKeys.push(verificationKey);
      return Response.json({ success: false });
    });
    const submit = (turnstileToken: string) =>
      appCall(form.path, runtime, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "verification-scope@example.com",
          "cf-turnstile-response": turnstileToken,
          idempotencyKey: "verification-scope-key",
        }),
      });

    expect((await submit("token-a")).status).toBe(422);
    expect((await submit("token-a")).status).toBe(422);
    expect((await submit("token-b")).status).toBe(422);

    expect(verificationKeys[0]).toBe(verificationKeys[1]);
    expect(verificationKeys[2]).not.toBe(verificationKeys[0]);
  });

  it("catches reusing a provider UUID for the same public key and token in another form workspace", async () => {
    const firstForm = await seedTurnstileForm();
    const secondForm = await seedTurnstileForm();
    const runtime = bindings({
      TURNSTILE_SITE_KEY: "site-test",
      TURNSTILE_SECRET: "secret-test",
    });
    const verificationKeys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = init?.body;
      if (!(body instanceof FormData)) throw new Error("Siteverify must receive FormData");
      const verificationKey = body.get("idempotency_key");
      if (typeof verificationKey !== "string") throw new Error("Siteverify key is missing");
      verificationKeys.push(verificationKey);
      return Response.json({ success: true });
    });
    const submit = (path: string) =>
      appCall(path, runtime, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "workspace-scope@example.com",
          "cf-turnstile-response": "shared-token",
          idempotencyKey: "shared-public-key",
        }),
      });

    expect((await submit(firstForm.path)).status).toBe(202);
    expect((await submit(secondForm.path)).status).toBe(202);

    expect(verificationKeys).toHaveLength(2);
    expect(verificationKeys[1]).not.toBe(verificationKeys[0]);
  });

  it("catches forwarding a non-UUID public replay key directly to Siteverify", async () => {
    const form = await seedTurnstileForm();
    const runtime = bindings({
      TURNSTILE_SITE_KEY: "site-test",
      TURNSTILE_SECRET: "secret-test",
    });
    const idempotencyKey = "checkout/order:2026-08-20#alpha";
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
    expect(verificationKeys).toHaveLength(1);
    expect(verificationKeys[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

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

  it.each([
    {
      transition: "publishing an enabled draft",
      initialStatus: "draft" as const,
      initialTurnstileEnabled: true,
    },
    {
      transition: "enabling a published form",
      initialStatus: "published" as const,
      initialTurnstileEnabled: false,
    },
  ])(
    "fails closed when $transition and permits it once both Turnstile keys exist",
    async ({ initialStatus, initialTurnstileEnabled }) => {
      const fixture = await seedWorkspace(env.DB);
      const initialClient = clientFor(
        fixture.token,
        bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: undefined }),
      );
      const form = await initialClient.website.createForm({
        name: "Transition form",
        slug: "transition-form",
        status: initialStatus,
        definition: { fields: [{ key: "email", type: "email", required: true }] },
        allowedDomains: [],
        turnstileEnabled: initialTurnstileEnabled,
        successMessage: "Thanks",
      });
      const publishEnabled = {
        id: form.id,
        name: "Transition form",
        slug: "transition-form",
        status: "published" as const,
        definition: { fields: [{ key: "email" as const, type: "email" as const, required: true }] },
        allowedDomains: [],
        turnstileEnabled: true,
        successMessage: "Thanks",
      };

      for (const incompleteConfiguration of [
        { TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: undefined },
        { TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: "secret-test" },
      ]) {
        const incompleteClient = clientFor(fixture.token, bindings(incompleteConfiguration));
        await expect(incompleteClient.website.updateForm(publishEnabled)).rejects.toMatchObject({
          code: "TURNSTILE_NOT_CONFIGURED",
          status: 422,
        });
        expect(
          await env.DB.prepare(
            `SELECT status, turnstile_enabled AS turnstileEnabled
             FROM forms WHERE id = ?`,
          )
            .bind(form.id)
            .first(),
        ).toEqual({ status: initialStatus, turnstileEnabled: initialTurnstileEnabled ? 1 : 0 });
      }

      const configuredClient = clientFor(
        fixture.token,
        bindings({ TURNSTILE_SITE_KEY: "site-test", TURNSTILE_SECRET: "secret-test" }),
      );
      await expect(configuredClient.website.updateForm(publishEnabled)).resolves.toEqual({
        id: form.id,
      });
      expect(
        await env.DB.prepare(
          `SELECT status, turnstile_enabled AS turnstileEnabled
           FROM forms WHERE id = ?`,
        )
          .bind(form.id)
          .first(),
      ).toEqual({ status: "published", turnstileEnabled: 1 });
    },
  );
});
