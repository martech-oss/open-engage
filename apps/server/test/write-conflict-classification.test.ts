import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ConsentRepository, createDatabase } from "@openengage/database/testing";

import { CompanyConflictError, createCompany } from "../src/contacts/company-service";
import { createTag, ResourceConflictError } from "../src/contacts/resource-service";
import { createMessageVariable, VariableConflictError } from "../src/messaging/service";
import { seedWorkspaceContext } from "./factory";

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}

describe("write conflict classification", () => {
  it("catches a company operational failure being rewritten as a domain conflict", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "company-operational");
    await env.DB.prepare("DROP TABLE companies").run();

    const error = await rejectionOf(
      createCompany(
        createDatabase(env.DB),
        workspace,
        { name: "Unavailable" },
        {
          waitUntil() {},
        },
      ),
    );
    expect(error).not.toBeInstanceOf(CompanyConflictError);
  });

  it("catches a tag operational failure being rewritten as a slug conflict", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "tag-operational");
    await env.DB.prepare("DROP TABLE tags").run();

    const error = await rejectionOf(
      createTag(createDatabase(env.DB), workspace, { name: "Unavailable", color: "#64748b" }),
    );
    expect(error).not.toBeInstanceOf(ResourceConflictError);
  });

  it("catches a messaging operational failure being rewritten as a key conflict", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "message-operational");
    await env.DB.prepare("DROP TABLE message_variables").run();

    const error = await rejectionOf(
      createMessageVariable(createDatabase(env.DB), workspace, {
        key: "unavailable",
        name: "Unavailable",
        value: "",
        description: "",
      }),
    );
    expect(error).not.toBeInstanceOf(VariableConflictError);
  });

  it("catches a consent operational failure being returned as a topic conflict", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "consent-operational");
    await env.DB.prepare("DROP TABLE subscription_topics").run();

    await expect(
      new ConsentRepository(createDatabase(env.DB), workspace).createTopic({
        name: "Unavailable",
        slug: "unavailable",
        description: "",
        isDefault: false,
      }),
    ).rejects.toBeTruthy();
  });
});
