import { describe, expect, it } from "vitest";

import { settingsPermissions } from "./settings-page";

describe("settingsPermissions", () => {
  it.each([
    ["owner", true, true],
    ["admin", true, true],
    ["marketer", false, false],
  ] as const)(
    "gates %s affordances with server capabilities",
    (_role, manageWorkspace, manageApiKeys) => {
      expect(
        settingsPermissions({
          viewReports: true,
          manageMarketing: true,
          manageWorkspace,
          manageApiKeys,
        }),
      ).toEqual({ canEditWorkspace: manageWorkspace, canManageApiKeys: manageApiKeys });
    },
  );
});
