import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidateQueryRoots } from "./query-invalidation";

describe("invalidateQueryRoots", () => {
  it("invalidates each declared query root including descendants and leaves unrelated data valid", async () => {
    const client = new QueryClient();
    client.setQueryData(["emails", "templates", { archived: false }], "templates");
    client.setQueryData(["emails", "variables"], "variables");
    client.setQueryData(["segments", "list"], "segments");

    await invalidateQueryRoots(client, ["emails", "templates"], ["emails", "variables"]);

    expect(client.getQueryState(["emails", "templates", { archived: false }])?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(["emails", "variables"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["segments", "list"])?.isInvalidated).toBe(false);
  });

  it("deduplicates repeated roots before invalidating", async () => {
    const client = new QueryClient();
    let notifications = 0;
    client.getQueryCache().subscribe(() => {
      notifications += 1;
    });
    client.setQueryData(["emails", "templates"], "templates");
    notifications = 0;

    await invalidateQueryRoots(client, ["emails", "templates"], ["emails", "templates"]);

    expect(notifications).toBe(1);
  });
});
