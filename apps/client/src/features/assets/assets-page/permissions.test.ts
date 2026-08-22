import { describe, expect, it } from "vitest";

import type { WorkspaceCapabilities } from "@openengage/core/workspaces";

import { assetPermissions } from "./permissions";

describe("assetPermissions", () => {
  it.each([
    [
      { viewReports: true, manageMarketing: true, manageWorkspace: true, manageApiKeys: true },
      true,
      true,
    ],
    [
      { viewReports: true, manageMarketing: true, manageWorkspace: false, manageApiKeys: false },
      true,
      false,
    ],
    [
      { viewReports: false, manageMarketing: false, manageWorkspace: false, manageApiKeys: false },
      false,
      false,
    ],
  ] satisfies Array<[WorkspaceCapabilities, boolean, boolean]>)(
    "uses workspace capabilities instead of reconstructing roles",
    (capabilities, canWrite, canDelete) => {
      expect(assetPermissions(capabilities)).toEqual({ canWrite, canDelete });
    },
  );
});
