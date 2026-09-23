import { describe, expect, it } from "vitest";

import { orpc, previewWriteMessage } from "./mock-orpc";

describe("preview oRPC mock", () => {
  it("serves GET procedures from fixtures and refuses writes", async () => {
    await expect(orpc.contacts.list({})).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(orpc.contacts.create({ email: "new@example.com" })).rejects.toThrow(
      previewWriteMessage,
    );
  });

  it("treats a GET the old name heuristic missed as a read", async () => {
    const outcome = await orpc.projects.briefGet({ id: "missing" }).catch((error: Error) => error);
    expect(outcome instanceof Error ? outcome.message : "").not.toBe(previewWriteMessage);
  });
});
