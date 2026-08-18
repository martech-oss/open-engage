import { describe, expect, it } from "vitest";

import { contactListInputSchema, contactListResultSchema } from "@openengage/core/contacts";
import { workspaceSchema } from "@openengage/core/workspaces";

import { contract } from "./contract";

describe("oRPC contract schemas", () => {
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
      }).role,
    ).toBe("owner");
  });
});

describe("v0.1 API contract", () => {
  it("exposes domain namespaces without legacy aliases", () => {
    expect(Object.keys(contract)).toEqual(
      expect.arrayContaining(["agents", "contacts", "dashboard", "platform", "workspace"]),
    );
    expect("operations" in contract).toBe(false);
    expect("contactResources" in contract).toBe(false);
    expect("agentConversations" in contract).toBe(false);
  });

  it("uses domain-prefixed REST paths", () => {
    expect.assertions(29);
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
