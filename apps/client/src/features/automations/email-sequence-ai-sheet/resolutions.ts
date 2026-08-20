import type {
  EmailSequenceGenerationResult,
  EmailSequenceResolution,
} from "@openengage/core/automations";

export const OMIT_VALUE = "__omit__";

export function buildSequenceResolutions(
  result: Extract<EmailSequenceGenerationResult, { status: "needs_input" }>,
  values: Record<string, string>,
): EmailSequenceResolution[] {
  const resolutions: EmailSequenceResolution[] = [];
  for (const request of result.requests) {
    const value = values[request.requestId];
    if (!value) continue;
    if (value === OMIT_VALUE) {
      resolutions.push({ requestId: request.requestId, decision: "omit" });
    } else if (request.inputType === "resource") {
      resolutions.push({ requestId: request.requestId, decision: "select", resourceId: value });
    } else {
      resolutions.push({ requestId: request.requestId, decision: "provide", value });
    }
  }
  return resolutions;
}
