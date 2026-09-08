import { describe, expect, it } from "vitest";

import * as variables from "./schema";
const definition = (
  key: string,
  type: string,
  value: unknown,
  projectId: string | null = null,
) => ({
  id: `${projectId ?? "workspace"}-${key}`,
  workspaceId: "ws",
  projectId,
  key,
  type,
  value,
  revision: 1,
  updatedAt: "2026-09-08T00:00:00.000Z",
});
describe("published variable resolution", () => {
  it("resolves project overrides and project-only keys retaining immutable revisions", () => {
    expect(typeof variables.createVariableSnapshot).toBe("function");
    const source = [
      definition("title", "string", "Workspace"),
      definition("title", "string", "Project", "p"),
      definition("count", "number", 4, "p"),
    ];
    const snapshot = variables.createVariableSnapshot(source, "ws", "p");
    expect(
      variables.resolveVariableRef({ kind: "variable", key: "title", type: "string" }, snapshot),
    ).toBe("Project");
    expect(
      variables.resolveVariableRef({ kind: "variable", key: "count", type: "number" }, snapshot),
    ).toBe(4);
    source[1]!.value = "Changed";
    expect(snapshot.values.find((value) => value.key === "title")).toMatchObject({
      value: "Project",
      revision: 1,
    });
  });
  it("refuses missing keys, foreign workspace and mismatched override types", () => {
    expect(typeof variables.createVariableSnapshot).toBe("function");
    const snapshot = variables.createVariableSnapshot(
      [definition("title", "string", "Workspace"), definition("other", "string", "Foreign", "q")],
      "ws",
      "p",
    );
    expect(() =>
      variables.resolveVariableRef({ kind: "variable", key: "missing", type: "string" }, snapshot),
    ).toThrow(/undefined/i);
    expect(() =>
      variables.resolveVariableRef({ kind: "variable", key: "title", type: "number" }, snapshot),
    ).toThrow(/type/i);
    expect(() =>
      variables.createVariableSnapshot(
        [definition("title", "string", "Workspace"), definition("title", "number", 1, "p")],
        "ws",
        "p",
      ),
    ).toThrow(/type/i);
    expect(() =>
      variables.createVariableSnapshot(
        [{ ...definition("x", "string", "leak"), workspaceId: "foreign" }],
        "ws",
        null,
      ),
    ).toThrow(/workspace/i);
    expect(snapshot.values.some((value) => value.key === "other")).toBe(false);
  });
  it("validates scalar types, finite numbers, zoned datetimes, URLs and refuses recursion", () => {
    expect(variables.variableDefinitionSchema).toBeDefined();
    for (const [type, value] of [
      ["number", "1"],
      ["boolean", "false"],
      ["number", Infinity],
      ["datetime", "2026-09-08"],
      ["url", "javascript:alert(1)"],
      ["url", "https://user:pass@example.com"],
      ["string", "{{variables.other}}"],
    ])
      expect(
        variables.variableDefinitionSchema.safeParse(definition("x", type as string, value))
          .success,
      ).toBe(false);
    for (const [type, value] of [
      ["string", "<b>Hello</b>"],
      ["number", 1.2],
      ["boolean", false],
      ["datetime", "2026-09-08T09:00:00+09:00"],
      ["url", "https://example.com"],
    ])
      expect(
        variables.variableDefinitionSchema.safeParse(definition("x", type as string, value))
          .success,
      ).toBe(true);
  });
  it("escapes HTML exactly once and refuses non-string interpolation", () => {
    expect(typeof variables.resolveVariableText).toBe("function");
    const snapshot = variables.createVariableSnapshot(
      [
        definition("title", "string", '<img src=x onerror="alert(1)"> & $&'),
        definition("count", "number", 3),
      ],
      "ws",
      null,
    );
    expect(
      variables.resolveVariableText("<h1>{{variables.title}}</h1>", snapshot, { html: true }),
    ).toBe("<h1>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; $&amp;</h1>");
    expect(() => variables.resolveVariableText("{{variables.count}}", snapshot)).toThrow(/type/i);
    expect(() => variables.resolveVariableText("{{variables.missing}}", snapshot)).toThrow(
      /undefined/i,
    );
  });
});
