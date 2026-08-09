import { describe, expect, it } from "vitest";

import { resolveCliCommand } from "./index";

describe("CLI command resolution", () => {
  it("resolves maintenance and nested domain commands", () => {
    expect(resolveCliCommand(["doctor"])).toEqual({ kind: "doctor" });
    expect(resolveCliCommand(["update"])).toEqual({ kind: "update" });
    expect(resolveCliCommand(["backup"])).toEqual({ kind: "backup" });
    expect(resolveCliCommand(["domain", "add"])).toEqual({ kind: "domain_add" });
  });

  it("treats an unknown first argument as the project directory", () => {
    expect(resolveCliCommand([])).toEqual({ kind: "create" });
    expect(resolveCliCommand(["create"])).toEqual({ kind: "create" });
    expect(resolveCliCommand(["my-project"])).toEqual({
      kind: "create",
      directoryArgument: "my-project",
    });
    expect(resolveCliCommand(["domain"])).toEqual({
      kind: "create",
      directoryArgument: "domain",
    });
  });
});
