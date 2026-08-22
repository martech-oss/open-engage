import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { orpcQuery } from "@/lib/orpc";

import { invalidateSegmentQueries } from "./segment-mutations";

describe("segment mutation cache declarations", () => {
  it("invalidates the list, addressed detail, and contact options only", async () => {
    const client = new QueryClient();
    const listKey = orpcQuery.segments.list.queryOptions({ input: {} }).queryKey;
    const addressedKey = orpcQuery.segments.get.queryOptions({
      input: { id: "segment-1" },
    }).queryKey;
    const otherKey = orpcQuery.segments.get.queryOptions({ input: { id: "segment-2" } }).queryKey;
    const contactsKey = orpcQuery.contacts.options.queryOptions().queryKey;
    const emailKey = orpcQuery.emails.listTemplates.queryOptions({
      input: { archived: false },
    }).queryKey;
    client.setQueryData(listKey as QueryKey, "list");
    client.setQueryData(addressedKey as QueryKey, "addressed");
    client.setQueryData(otherKey as QueryKey, "other");
    client.setQueryData(contactsKey as QueryKey, "contacts");
    client.setQueryData(emailKey as QueryKey, "email");

    await invalidateSegmentQueries(client, "segment-1");

    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(addressedKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(contactsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(emailKey)?.isInvalidated).toBe(false);
  });
});
