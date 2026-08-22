import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { orpcQuery } from "@/lib/orpc";

import { invalidateEmailTemplateQueries, invalidateEmailVariableQueries } from "./email-mutations";

describe("email mutation cache declarations", () => {
  it("invalidates active and archived template queries while preserving variable data", async () => {
    const client = new QueryClient();
    const activeKey = orpcQuery.emails.listTemplates.queryOptions({
      input: { archived: false },
    }).queryKey;
    const archivedKey = orpcQuery.emails.listTemplates.queryOptions({
      input: { archived: true },
    }).queryKey;
    const variablesKey = orpcQuery.emails.listVariables.queryOptions({
      input: { archived: false },
    }).queryKey;
    client.setQueryData(activeKey as QueryKey, "active");
    client.setQueryData(archivedKey as QueryKey, "archived");
    client.setQueryData(variablesKey as QueryKey, "variables");

    await invalidateEmailTemplateQueries(client);

    expect(client.getQueryState(activeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(archivedKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(variablesKey)?.isInvalidated).toBe(false);
  });

  it("invalidates variable queries without invalidating templates", async () => {
    const client = new QueryClient();
    const variablesKey = orpcQuery.emails.listVariables.queryOptions({
      input: { archived: false },
    }).queryKey;
    const templatesKey = orpcQuery.emails.listTemplates.queryOptions({
      input: { archived: false },
    }).queryKey;
    client.setQueryData(variablesKey as QueryKey, "variables");
    client.setQueryData(templatesKey as QueryKey, "templates");

    await invalidateEmailVariableQueries(client);

    expect(client.getQueryState(variablesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(templatesKey)?.isInvalidated).toBe(false);
  });
});
