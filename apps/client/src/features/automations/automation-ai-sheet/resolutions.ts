import type {
  AutomationGenerationResult,
  AutomationResourceResolution,
} from "@openengage/core/automations";

export const OMIT_VALUE = "__omit__";

export function buildResolutions(
  result: Extract<AutomationGenerationResult, { status: "needs_input" }>,
  selections: Record<string, string>,
): AutomationResourceResolution[] {
  const resolutions: AutomationResourceResolution[] = [];
  for (const request of result.resources) {
    const value = selections[request.requestId];
    if (!value) continue;
    resolutions.push(
      value === OMIT_VALUE
        ? { requestId: request.requestId, decision: "omit" }
        : { requestId: request.requestId, decision: "select", resourceId: value },
    );
  }
  return resolutions;
}
