import { expect, it } from "vitest";

import { isNotNullConstraintError } from "./database-utils";

it("recognizes the exact NOT NULL column through D1 and Drizzle causes", () => {
  const sqlite = new Error("NOT NULL constraint failed: project_variables.type: SQLITE_CONSTRAINT");
  const d1 = new Error(`D1_ERROR: ${sqlite.message}`, { cause: sqlite });
  expect(isNotNullConstraintError(sqlite, "project_variables.type")).toBe(true);
  expect(isNotNullConstraintError(d1, "project_variables.type")).toBe(true);
  expect(
    isNotNullConstraintError(
      new Error("Failed query: insert ...", { cause: d1 }),
      "project_variables.type",
    ),
  ).toBe(true);
});

it.each([
  new Error("D1_ERROR: NOT NULL constraint failed: project_variables.value: SQLITE_CONSTRAINT"),
  new Error(
    "D1_ERROR: NOT NULL constraint failed: project_variables.type_extra: SQLITE_CONSTRAINT",
  ),
  new Error("D1_ERROR: UNIQUE constraint failed: project_variables.type: SQLITE_CONSTRAINT"),
  new Error("D1_ERROR: no such table: project_variables"),
  new Error("Failed query: insert ...\nparams: NOT NULL constraint failed: project_variables.type"),
  null,
])("does not classify unrelated failures as a variable type conflict: %s", (error) => {
  expect(isNotNullConstraintError(error, "project_variables.type")).toBe(false);
});
