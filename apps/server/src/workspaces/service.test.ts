import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";

import { createWorkspaceOrganizationWithRetry } from "./service";

describe("createWorkspaceOrganizationWithRetry", () => {
  it("never retries an unrecognized post-insert failure", async () => {
    const failure = new Error("member hook failed after organization insert");
    const createOrganization = vi.fn<() => Promise<never>>(async () => {
      throw failure;
    });

    await expect(
      createWorkspaceOrganizationWithRetry({
        nextSlug: async () => "workspace",
        createOrganization,
      }),
    ).rejects.toBe(failure);
    expect(createOrganization).toHaveBeenCalledTimes(1);
  });

  it("retries the positively identified pre-insert organization collision", async () => {
    const nextSlug = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("workspace")
      .mockResolvedValueOnce("workspace-2");
    const createOrganization = vi
      .fn<(slug: string) => Promise<{ id: string; name: string; slug: string }>>()
      .mockRejectedValueOnce(
        new APIError("BAD_REQUEST", {
          code: "ORGANIZATION_ALREADY_EXISTS",
          message: "Organization already exists",
        }),
      )
      .mockResolvedValueOnce({ id: "workspace-id", name: "Workspace", slug: "workspace-2" });

    await expect(
      createWorkspaceOrganizationWithRetry({ nextSlug, createOrganization }),
    ).resolves.toMatchObject({ slug: "workspace-2" });
    expect(createOrganization).toHaveBeenCalledTimes(2);
  });
});
