import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@openengage/database/testing";
import type { WorkspaceRole } from "@openengage/orpc";

import { seedWorkspaceClient } from "./factory";

/** Seeds a workspace with an API key at the given role and returns a client for it. */
function seedWorkspace(role: WorkspaceRole = "owner") {
  return seedWorkspaceClient(env.DB, { role, timezone: "Asia/Tokyo" });
}

describe("accounts over oRPC", () => {
  it("creates, reads, updates and lists an account", async () => {
    const { workspaceId, client } = await seedWorkspace();

    const created = await client.companies.create({ name: "Acme Inc", domain: "acme.example" });
    expect(created).toMatchObject({
      workspaceId,
      name: "Acme Inc",
      domain: "acme.example",
    });

    const detail = await client.companies.get({ id: created.id });
    expect(detail).toMatchObject({ id: created.id, name: "Acme Inc", contacts: [] });

    const updated = await client.companies.update({ id: created.id, name: "Acme Group" });
    expect(updated).toMatchObject({ id: created.id, name: "Acme Group" });

    const listed = await client.companies.list({ query: "Acme" });
    expect(listed).toEqual([
      expect.objectContaining({ id: created.id, name: "Acme Group", contactCount: 0 }),
    ]);
  });

  it("reports a typed error for an account in another workspace", async () => {
    const { client } = await seedWorkspace();
    const other = await seedWorkspace();
    const hidden = await other.client.companies.create({ name: "Hidden Co" });

    await expect(client.companies.get({ id: hidden.id })).rejects.toMatchObject({
      code: "COMPANY_NOT_FOUND",
      status: 404,
      defined: true,
    });
  });

  it("attaches a contact, exposes it in camelCase, and counts it", async () => {
    const { client } = await seedWorkspace();
    const account = await client.companies.create({ name: "Contoso" });
    const contact = await client.contacts.create({
      email: "person@contoso.example",
      firstName: "Taro",
      lastName: "Yamada",
      customFields: {},
    });

    await expect(
      client.companies.assignContact({
        id: account.id,
        contactId: contact.id,
        title: "CTO",
        isPrimary: true,
      }),
    ).resolves.toEqual({ ok: true });

    const detail = await client.companies.get({ id: account.id });
    expect(detail.contacts).toEqual([
      expect.objectContaining({
        id: contact.id,
        firstName: "Taro",
        lastName: "Yamada",
        title: "CTO",
        isPrimary: true,
        status: "active",
      }),
    ]);

    const listed = await client.companies.list({});
    expect(listed.find((row) => row.id === account.id)?.contactCount).toBe(1);

    await expect(
      client.companies.removeContact({ id: account.id, contactId: contact.id }),
    ).resolves.toEqual({ ok: true });
    await expect(client.companies.get({ id: account.id })).resolves.toMatchObject({ contacts: [] });
  });

  it("rejects attaching a contact that does not exist", async () => {
    const { client } = await seedWorkspace();
    const account = await client.companies.create({ name: "Initech" });

    await expect(
      client.companies.assignContact({
        id: account.id,
        contactId: uuidv7(),
        isPrimary: false,
      }),
    ).rejects.toMatchObject({ code: "COMPANY_CONTACT_NOT_FOUND", status: 404 });
  });

  it("rejects a write from a role below marketer", async () => {
    const { client } = await seedWorkspace("viewer");

    await expect(client.companies.create({ name: "Readonly Co" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  // /api/v1 is the OpenAPIHandler rendering of the same procedures for the
  // SDK and OpenAPI document: same output DTOs as plain JSON (no
  // envelope), typed error codes as the error body. Driving one operation over
  // both surfaces catches them drifting apart.
  it("serves the same data over the REST routes", async () => {
    const { token, client } = await seedWorkspace();
    const created = await client.companies.create({ name: "Umbrella", domain: "umbrella.example" });

    const rest = (path: string, init?: RequestInit) =>
      exports.default.fetch(
        new Request(`http://localhost:8787/api/v1${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            ...(init?.body ? { "content-type": "application/json" } : {}),
          },
        }),
      );

    const listed = await rest("/companies?query=Umbrella");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual(
      await client.companies.list({ query: "Umbrella" }),
    );

    const detail = await rest(`/companies/${created.id}`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toEqual(await client.companies.get({ id: created.id }));

    const missing = await rest(`/companies/${uuidv7()}`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      code: "COMPANY_NOT_FOUND",
      defined: true,
    });

    const conflict = await rest("/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Umbrella Two", domain: "umbrella.example" }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "COMPANY_CONFLICT",
      defined: true,
    });
  });
});
