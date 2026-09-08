import { describe, expect, it } from "vitest";

import * as program from "./schema";

const definition = {
  kind: "event",
  initialStatusId: "invited",
  statuses: [
    { id: "invited", label: "Invited", success: false, nextStatusIds: ["registered"] },
    {
      id: "registered",
      label: "Registered",
      success: false,
      nextStatusIds: ["attended", "absent"],
    },
    { id: "attended", label: "Attended", success: true, nextStatusIds: [] },
    { id: "absent", label: "Absent", success: false, nextStatusIds: [] },
  ],
};

describe("versioned program membership semantics", () => {
  it("rejects cycles, missing initial statuses and duplicate status identifiers", () => {
    expect(program.projectProgramDefinitionSchema).toBeDefined();
    expect(program.projectProgramDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(
      program.projectProgramDefinitionSchema.safeParse({
        ...definition,
        initialStatusId: "missing",
      }).success,
    ).toBe(false);
    expect(
      program.projectProgramDefinitionSchema.safeParse({
        ...definition,
        statuses: [...definition.statuses, definition.statuses[0]],
      }).success,
    ).toBe(false);
    expect(
      program.projectProgramDefinitionSchema.safeParse({
        ...definition,
        statuses: definition.statuses.map((s) =>
          s.id === "attended" ? { ...s, nextStatusIds: ["invited"] } : s,
        ),
      }).success,
    ).toBe(false);
  });
  it("allows forward skips but rejects a normal rewind or branch change", () => {
    expect(program.resolveProgramProgress).toBeTypeOf("function");
    const parsed = program.projectProgramDefinitionSchema.parse(definition);
    expect(
      program.resolveProgramProgress(
        parsed,
        { statusId: "invited", firstSuccessAt: null },
        { statusId: "attended", source: "automation", mode: "progress" },
        "2026-09-02T00:00:00.000Z",
      ),
    ).toEqual({ statusId: "attended", firstSuccessAt: "2026-09-02T00:00:00.000Z" });
    expect(() =>
      program.resolveProgramProgress(
        parsed,
        { statusId: "attended", firstSuccessAt: "2026-09-02T00:00:00.000Z" },
        { statusId: "absent", source: "api", mode: "progress" },
        "2026-09-03T00:00:00.000Z",
      ),
    ).toThrow(/correction/);
  });
  it("requires a human reason for correction and removes incorrectly awarded success", () => {
    expect(program.resolveProgramProgress).toBeTypeOf("function");
    const parsed = program.projectProgramDefinitionSchema.parse(definition);
    const before = { statusId: "attended", firstSuccessAt: "2026-09-02T00:00:00.000Z" };
    expect(() =>
      program.resolveProgramProgress(
        parsed,
        before,
        { statusId: "absent", source: "manual", mode: "correction" },
        "2026-09-03T00:00:00.000Z",
      ),
    ).toThrow(/reason/);
    expect(() =>
      program.resolveProgramProgress(
        parsed,
        before,
        { statusId: "absent", source: "automation", mode: "correction", reason: "Fix" },
        "2026-09-03T00:00:00.000Z",
      ),
    ).toThrow(/manual/);
    expect(
      program.resolveProgramProgress(
        parsed,
        before,
        { statusId: "attended", source: "manual", mode: "progress" },
        "2026-09-03T00:00:00.000Z",
      ),
    ).toEqual(before);
    expect(
      program.resolveProgramProgress(
        parsed,
        before,
        {
          statusId: "absent",
          source: "manual",
          mode: "correction",
          reason: "Badge scanned in error",
        },
        "2026-09-03T00:00:00.000Z",
      ),
    ).toEqual({ statusId: "absent", firstSuccessAt: null });
  });
  it("does not rewind a progressed participant when the same form is submitted again", () => {
    const parsed = program.projectProgramDefinitionSchema.parse(definition);
    const current = { statusId: "attended", firstSuccessAt: "2026-09-02T00:00:00.000Z" };
    expect(
      program.resolveProgramProgress(
        parsed,
        current,
        { statusId: "registered", source: "form" },
        "2026-09-03T00:00:00.000Z",
      ),
    ).toEqual(current);
  });
  it("parses quoted CSV and reports malformed rows independently", () => {
    expect(program.parseProgramMemberCsv).toBeTypeOf("function");
    expect(
      program.parseProgramMemberCsv(
        'email,statusId\r\n"a@example.com",registered\r\nmissing@example.com,attended,extra',
      ),
    ).toEqual([
      { row: 2, email: "a@example.com", statusId: "registered" },
      { row: 3, error: "Column count does not match header" },
    ]);
    expect(() => program.parseProgramMemberCsv("name,statusId\nPerson,attended")).toThrow(
      /contactId or email/,
    );
  });
});
