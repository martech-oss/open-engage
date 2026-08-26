import { describe, expect, it } from "vitest";
import type * as z from "zod";

import { contactListInputSchema, contactListResultSchema } from "@openengage/core/contacts";
import { workspaceSchema } from "@openengage/core/workspaces";

import { contract } from "./contract";

describe("oRPC contract schemas", () => {
  it("projects app bootstrap output to the session-safe client shape", () => {
    const output = contract.app.bootstrap["~orpc"].outputSchema as z.ZodType;

    expect(
      output.parse({
        viewer: {
          id: "user-1",
          name: "Person",
          email: "person@example.test",
          emailVerified: true,
        },
        workspace: null,
        workspaces: [{ id: "workspace-1", name: "Acme", slug: "acme", role: "owner" }],
        session: {
          id: "session-1",
          token: "must-not-escape",
          ipAddress: "203.0.113.1",
          userAgent: "sentinel-agent",
        },
      }),
    ).toEqual({
      viewer: { id: "user-1", name: "Person", email: "person@example.test" },
      workspace: null,
      workspaces: [{ id: "workspace-1", name: "Acme", slug: "acme" }],
    });
  });

  it.each(["deals", "campaigns"] as const)(
    "keeps the shared report range refinements on %s input",
    (endpoint) => {
      const schema = contract.reports[endpoint]["~orpc"].inputSchema as z.ZodType;

      expect(schema.safeParse({ from: "2026-02-02", to: "2026-02-01" }).success).toBe(false);
      expect(schema.safeParse({ from: "2025-01-01", to: "2026-01-02" }).success).toBe(false);
      expect(schema.parse({ from: "2026-01-01", to: "2026-12-31", currency: "jpy" })).toEqual({
        from: "2026-01-01",
        to: "2026-12-31",
        currency: "JPY",
      });
    },
  );

  it("accepts contact search input", () => {
    expect(
      contactListInputSchema.parse({
        limit: 100,
        status: "active",
        sort: "updatedAt",
        direction: "desc",
      }),
    ).toEqual({
      limit: 100,
      status: "active",
      sort: "updatedAt",
      direction: "desc",
    });
  });

  it("rejects invalid contact list output", () => {
    expect(() => contactListResultSchema.parse({ items: [], total: -1 })).toThrow();
  });

  it("validates workspace roles", () => {
    expect(
      workspaceSchema.parse({
        id: "workspace-id",
        name: "OpenEngage",
        slug: "openengage",
        logo: null,
        timezone: "Asia/Tokyo",
        created_at: Date.now(),
        role: "owner",
        capabilities: {
          viewReports: true,
          manageMarketing: true,
          manageWorkspace: true,
          manageApiKeys: true,
        },
      }).role,
    ).toBe("owner");
  });

  it.each([
    ["segments.create", contract.segments.create, { name: "日本語", kind: "static" }],
    [
      "website.createPage",
      contract.website.createPage,
      { name: "日本語", content: { schemaVersion: 1, blocks: [] } },
    ],
    [
      "website.createForm",
      contract.website.createForm,
      { name: "日本語", definition: {}, allowedDomains: [], turnstileEnabled: false },
    ],
  ] as const)("allows %s input to omit slug", (_label, procedure, input) => {
    const schema = procedure["~orpc"].inputSchema as z.ZodType;
    expect(schema.safeParse(input).success).toBe(true);
  });

  it.each([
    ["updatePage", { id: "page", name: "日本語", content: { schemaVersion: 1, blocks: [] } }],
    [
      "updateForm",
      {
        id: "form",
        name: "日本語",
        definition: {},
        allowedDomains: [],
        turnstileEnabled: false,
      },
    ],
  ] as const)("keeps website.%s update slug explicit", (procedure, input) => {
    const schema = contract.website[procedure]["~orpc"].inputSchema as z.ZodType;
    expect(schema.safeParse(input).success).toBe(false);
  });

  it.each([
    [
      contract.segments.create,
      { name: "Segment", slug: " Segment_日本 ", kind: "static" },
      "segment",
    ],
    [
      contract.website.createPage,
      { name: "Page", slug: " Launch_日本 ", content: { schemaVersion: 1, blocks: [] } },
      "launch",
    ],
    [
      contract.website.createForm,
      {
        name: "Form",
        slug: " Signup_日本 ",
        definition: {},
        allowedDomains: [],
        turnstileEnabled: false,
      },
      "signup",
    ],
  ] as const)("normalizes explicit resource slugs", (procedure, input, expected) => {
    const schema = procedure["~orpc"].inputSchema as z.ZodType<{ slug: string }>;
    expect(schema.parse(input).slug).toBe(expected);
  });
});

describe("v0.1 API contract", () => {
  it("exposes domain namespaces without legacy aliases", () => {
    expect(Object.keys(contract)).toEqual(
      expect.arrayContaining(["agents", "app", "contacts", "dashboard", "platform", "workspace"]),
    );
    expect("operations" in contract).toBe(false);
    expect("contactResources" in contract).toBe(false);
    expect("agentConversations" in contract).toBe(false);
  });

  it("uses domain-prefixed REST paths", () => {
    expect.assertions(30);
    expectRoute(contract.app.bootstrap, "GET", "/app/bootstrap");
    expectRoute(contract.dashboard.get, "GET", "/dashboard");
    expectRoute(contract.workspace.createApiKey, "POST", "/workspace/api-keys");
    expectRoute(contract.workspace.listWebhookEndpoints, "GET", "/workspace/webhooks");
    expectRoute(contract.contacts.startImport, "POST", "/contacts/imports");
    expectRoute(contract.contacts.startExport, "POST", "/contacts/exports");
    expectRoute(contract.contacts.getDataJob, "GET", "/contacts/data-jobs/{id}");
    expectRoute(contract.contacts.downloadExport, "GET", "/contacts/exports/{id}/download");
    expectRoute(contract.contacts.archive, "POST", "/contacts/{id}/archive");
    expectRoute(contract.contacts.restore, "POST", "/contacts/{id}/restore");
    expectRoute(contract.contacts.options, "GET", "/contacts/options");
    expectRoute(contract.contacts.updateTag, "PATCH", "/contacts/tags/{id}");
    expectRoute(contract.contacts.assignTag, "POST", "/contacts/{contactId}/tags");
    expectRoute(contract.contacts.addToSegment, "POST", "/contacts/{contactId}/segments");
    expectRoute(contract.contacts.bulkUpdate, "POST", "/contacts/bulk-update");
    expectRoute(contract.emails.listTemplates, "GET", "/emails/templates");
    expectRoute(contract.emails.listVariables, "GET", "/emails/variables");
    expectRoute(contract.emails.listSegmentOptions, "GET", "/emails/options/segments");
    expectRoute(contract.website.listForms, "GET", "/website/forms");
    expectRoute(contract.website.listPages, "GET", "/website/pages");
    expectRoute(contract.website.listMessages, "GET", "/website/messages");
    expectRoute(contract.website.getTracking, "GET", "/website/tracking");
    expectRoute(contract.automations.generate, "POST", "/automations/generate");
    expectRoute(contract.projects.briefWithdraw, "POST", "/projects/{id}/brief/withdraw");
    expectRoute(contract.platform.listDeadLetters, "GET", "/platform/dead-letters");
    expectRoute(contract.agents.conversations.list, "GET", "/agents/conversations");
    expectRoute(contract.deals.listTasks, "GET", "/deals/tasks");
    expectRoute(contract.deals.createPipeline, "POST", "/deals/pipelines");
    expectRoute(contract.deals.updatePipeline, "PATCH", "/deals/pipelines/{id}");
    expectRoute(contract.deals.archivePipeline, "POST", "/deals/pipelines/{id}/archive");
  });
});

interface RoutableProcedure {
  "~orpc": { route: { method?: string; path?: string } };
}

function expectRoute(procedure: RoutableProcedure, method: string, path: string): void {
  expect(procedure["~orpc"].route).toMatchObject({ method, path });
}
