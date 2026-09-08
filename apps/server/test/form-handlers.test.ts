import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database/client";

import type { RuntimeEnv } from "../src/env";
import { SubmitPublicFormUseCase } from "../src/public/submit-form-use-case";
import { seedWorkspaceClient } from "./factory";

describe("external form handlers", () => {
  it("maps JSON and HTML fields through shared validation, skips hidden values, and deduplicates", async () => {
    const { client, slug, workspaceId } = await seedWorkspaceClient(env.DB);
    const form = await client.website.createForm({
      name: "External",
      status: "published",
      definition: {
        fields: [
          { key: "email", type: "email", required: true },
          { key: "company", kind: "custom" },
          {
            key: "size",
            kind: "custom",
            visibleWhen: { field: "company", operator: "not_empty" },
            requiredWhen: { field: "company", operator: "not_empty" },
          },
        ],
      },
      turnstileEnabled: false,
    });
    await client.website.createFormHandler({
      name: "Website",
      slug: "inquiry",
      formId: form.id,
      fieldMapping: { email_address: "email", organization: "company", employee_count: "size" },
      allowedDomains: ["example.com"],
      successUrl: "https://example.com/thanks",
      failureUrl: "https://example.com/error",
    });
    const preflight = await exports.default.fetch(
      new Request(`http://localhost:8787/fh/${slug}/inquiry`, {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,idempotency-key",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://example.com");
    const send = (body: Record<string, string>, html = false, origin = "https://example.com") =>
      exports.default.fetch(
        new Request(`http://localhost:8787/fh/${slug}/inquiry`, {
          method: "POST",
          redirect: "manual",
          headers: {
            origin,
            "content-type": html ? "application/x-www-form-urlencoded" : "application/json",
          },
          body: html ? new URLSearchParams(body).toString() : JSON.stringify(body),
        }),
      );
    const input = {
      email_address: "external@example.com",
      employee_count: "hidden-value",
      idempotencyKey: crypto.randomUUID(),
    };
    expect((await send(input)).status).toBe(202);
    expect((await send(input)).status).toBe(202);
    const contact = await env.DB.prepare(
      "SELECT custom_fields FROM contacts WHERE workspace_id = ? AND email = ?",
    )
      .bind(workspaceId, input.email_address)
      .first<{ custom_fields: string }>();
    expect(JSON.parse(contact!.custom_fields)).toEqual({});
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM form_submissions WHERE workspace_id=?")
        .bind(workspaceId)
        .first(),
    ).toEqual({ count: 1 });
    const html = await send(
      {
        email_address: "html@example.com",
        organization: "Acme",
        employee_count: "20",
        idempotencyKey: crypto.randomUUID(),
      },
      true,
    );
    expect(html.status).toBe(303);
    expect(html.headers.get("location")).toBe("https://example.com/thanks");
    const missing = await send(
      {
        email_address: "missing@example.com",
        organization: "Acme",
        idempotencyKey: crypto.randomUUID(),
      },
      true,
    );
    expect(missing.headers.get("location")).toBe("https://example.com/error");
    expect(
      (await send({ ...input, idempotencyKey: crypto.randomUUID() }, false, "https://denied.test"))
        .status,
    ).toBe(403);
  });

  it("rejects foreign forms, unknown field mappings and dependency cycles", async () => {
    const first = await seedWorkspaceClient(env.DB),
      second = await seedWorkspaceClient(env.DB);
    const form = await first.client.website.createForm({
      name: "Form",
      status: "published",
      definition: {},
      turnstileEnabled: false,
    });
    const input = {
      name: "Handler",
      slug: "handler",
      formId: form.id,
      fieldMapping: { email: "email" },
      allowedDomains: ["example.com"],
      successUrl: "https://example.com/thanks",
      failureUrl: "https://example.com/error",
    };
    await expect(second.client.website.createFormHandler(input)).rejects.toMatchObject({
      code: "HANDLER_INVALID",
    });
    await expect(
      first.client.website.createFormHandler({
        ...input,
        fieldMapping: { email: "email", unknown: "missing" },
      }),
    ).rejects.toMatchObject({ code: "HANDLER_INVALID" });
    await expect(
      first.client.website.createForm({
        name: "Cycle",
        definition: {
          fields: [
            { key: "a", kind: "custom", visibleWhen: { field: "b", operator: "not_empty" } },
            { key: "b", kind: "custom", visibleWhen: { field: "a", operator: "not_empty" } },
          ],
        },
        turnstileEnabled: false,
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects failed Turnstile before a shared form submission mutates contact data", async () => {
    const { client, workspaceId, slug } = await seedWorkspaceClient(env.DB);
    const form = await client.website.createForm({
      name: "Protected",
      slug: "protected",
      status: "published",
      definition: {},
      turnstileEnabled: false,
    });
    await env.DB.prepare("UPDATE forms SET turnstile_enabled=1 WHERE id=?").bind(form.id).run();
    const result = await new SubmitPublicFormUseCase(createDatabase(env.DB), {
      ...env,
      TURNSTILE_SITE_KEY: "configured",
      TURNSTILE_SECRET: "configured",
    } as unknown as RuntimeEnv).execute({
      workspaceSlug: slug,
      formSlug: "protected",
      body: { email: "blocked@example.com", idempotencyKey: crypto.randomUUID() },
      origin: "https://example.com",
      requestHostname: "localhost",
      connectingIp: undefined,
      idempotencyKeyHeader: undefined,
    });
    expect(result.kind).toBe("turnstile_failed");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM contacts WHERE workspace_id=?")
        .bind(workspaceId)
        .first(),
    ).toEqual({ count: 0 });
  });
});
