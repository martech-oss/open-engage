import * as z from "zod";

export const variableTypeSchema = z.enum(["string", "number", "boolean", "datetime", "url"]);
export type VariableType = z.infer<typeof variableTypeSchema>;
export const variableKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const literalString = z
  .string()
  .max(20_000)
  .refine(
    (value) => !/\{\{/.test(value),
    "Recursive/script variable expressions are not supported",
  );
const scalarSchemas = {
  string: literalString,
  number: z.number().finite(),
  boolean: z.boolean(),
  datetime: z.iso.datetime({ offset: true }),
  url: z
    .url()
    .max(2000)
    .refine((value) => {
      const url = URL.parse(value);
      return Boolean(
        url &&
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !Array.from(value).some(
          (character) => character.charCodeAt(0) <= 32 || character === "{" || character === "}",
        ),
      );
    }, "Invalid variable URL: only absolute http(s) URLs without credentials are supported"),
};
export const variableValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: scalarSchemas.string }),
  z.object({ type: z.literal("number"), value: scalarSchemas.number }),
  z.object({ type: z.literal("boolean"), value: scalarSchemas.boolean }),
  z.object({ type: z.literal("datetime"), value: scalarSchemas.datetime }),
  z.object({ type: z.literal("url"), value: scalarSchemas.url }),
]);
export const variableWriteSchema = z
  .object({
    projectId: z.string().min(1).nullable().default(null),
    key: variableKeySchema,
    type: variableTypeSchema,
    value: z.union([z.string(), z.number(), z.boolean()]),
    expectedRevision: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (!scalarSchemas[value.type].safeParse(value.value).success)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Invalid ${value.type} variable value`,
      });
  });
export type VariableWrite = z.infer<typeof variableWriteSchema>;
export const variableDefinitionSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    projectId: z.string().min(1).nullable(),
    key: variableKeySchema,
    type: variableTypeSchema,
    value: z.union([z.string(), z.number(), z.boolean()]),
    revision: z.number().int().positive(),
    updatedAt: z.string(),
  })
  .superRefine((value, ctx) => {
    if (!scalarSchemas[value.type].safeParse(value.value).success)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Invalid ${value.type} variable value`,
      });
  });
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>;
export const variableRefSchema = z
  .object({ kind: z.literal("variable"), key: variableKeySchema, type: variableTypeSchema })
  .strict();
export type VariableRef = z.infer<typeof variableRefSchema>;
export function typedVariableRefSchema<T extends VariableType>(type: T) {
  return variableRefSchema.extend({ type: z.literal(type) });
}
export const variableSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().min(1).nullable(),
  values: z.array(variableDefinitionSchema),
});
export type VariableSnapshot = z.infer<typeof variableSnapshotSchema>;

export class VariableResolutionError extends Error {
  constructor(
    public readonly kind: "undefined" | "type" | "context" | "expression",
    message: string,
  ) {
    super(message);
    this.name = "VariableResolutionError";
  }
}

/** Copies validated scalar definitions. No caller-owned objects are retained. */
export function createVariableSnapshot(
  definitions: readonly unknown[],
  workspaceId: string,
  projectId: string | null,
): VariableSnapshot {
  const parsed = definitions.map((value) => variableDefinitionSchema.parse(value));
  if (parsed.some((value) => value.workspaceId !== workspaceId))
    throw new VariableResolutionError("context", "Variable workspace mismatch");
  const effective = new Map<string, VariableDefinition>();
  for (const value of parsed.filter((value) => value.projectId === null))
    effective.set(value.key, value);
  if (projectId)
    for (const value of parsed.filter((value) => value.projectId === projectId)) {
      const inherited = effective.get(value.key);
      if (inherited && inherited.type !== value.type)
        throw new VariableResolutionError("type", `Variable type mismatch: ${value.key}`);
      effective.set(value.key, value);
    }
  return {
    schemaVersion: 1,
    projectId,
    values: [...effective.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

type ScalarFor<T extends VariableType> = T extends "number"
  ? number
  : T extends "boolean"
    ? boolean
    : string;
export function resolveVariableRef<T extends VariableType>(
  ref: VariableRef & { type: T },
  snapshot: VariableSnapshot,
): ScalarFor<T> {
  variableRefSchema.parse(ref);
  const value = snapshot.values.find((value) => value.key === ref.key);
  if (!value) throw new VariableResolutionError("undefined", `Undefined variable: ${ref.key}`);
  variableDefinitionSchema.parse(value);
  if (value.type !== ref.type)
    throw new VariableResolutionError(
      "type",
      `Variable type mismatch: ${ref.key} requires ${ref.type}, found ${value.type}`,
    );
  return value.value as ScalarFor<T>;
}

/** Draft inspection retains valid uses even when another expression is malformed. */
export function inspectVariableTextReferences(text: string) {
  const refs: VariableRef[] = [];
  const remaining = text.replace(
    /\{\{\s*variables\.([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}/g,
    (_match, key: string) => {
      refs.push({ kind: "variable", key, type: "string" });
      return "";
    },
  );
  return {
    references: refs,
    diagnostics: /\{\{\s*variables\b/.test(remaining) ? ["Invalid variable expression"] : [],
  };
}
export function variableTextReferences(text: string): VariableRef[] {
  const { references, diagnostics } = inspectVariableTextReferences(text);
  if (diagnostics.length) throw new VariableResolutionError("expression", diagnostics[0]!);
  return references;
}
export function resolveVariableText(
  text: string,
  snapshot: VariableSnapshot,
  options: { html?: boolean } = {},
): string {
  variableTextReferences(text);
  return text.replace(
    /\{\{\s*variables\.([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}/g,
    (_match, key: string) => {
      const value = resolveVariableRef({ kind: "variable", key, type: "string" }, snapshot);
      return options.html
        ? value.replace(
            /[&<>"']/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
          )
        : value;
    },
  );
}

export const variableUsageSchema = z.object({
  resourceType: z.enum(["landing_page", "form", "automation"]),
  resourceId: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  versionId: z.string().nullable(),
  published: z.boolean(),
  references: z.array(variableRefSchema),
  snapshot: variableSnapshotSchema.nullable(),
  dependencyPath: z.array(z.string()).default([]),
  diagnostics: z.array(z.string()).default([]),
});
export type VariableUsage = z.infer<typeof variableUsageSchema>;
export const variableImpactSchema = variableUsageSchema.extend({
  before: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  after: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  requiresRepublish: z.boolean(),
  error: z.string().nullable(),
});

export const variableImpactInputSchema = variableWriteSchema.safeExtend({
  remove: z.boolean().default(false),
});
export type VariableImpactInput = z.infer<typeof variableImpactInputSchema>;
