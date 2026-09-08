import {
  inspectVariableTextReferences,
  type VariableRef,
  type VariableUsage,
} from "@openengage/core/projects";

/** Each resource is inspected independently; malformed draft text cannot hide its valid uses. */
export function inspectUsage(
  collect: (textReferences: (text: string) => VariableRef[]) => VariableRef[],
): Pick<VariableUsage, "references" | "diagnostics"> {
  const diagnostics = new Set<string>();
  let references: VariableRef[] = [];
  try {
    references = collect((text) => {
      const result = inspectVariableTextReferences(text);
      for (const diagnostic of result.diagnostics) diagnostics.add(diagnostic);
      return result.references;
    });
  } catch (error) {
    diagnostics.add(error instanceof Error ? error.message : "Invalid variable source");
  }
  return { references, diagnostics: [...diagnostics] };
}
