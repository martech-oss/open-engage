import { defineTool, type JsonValue } from "@flue/runtime";
import * as v from "valibot";

import {
  type AutomationDefinition,
  type AutomationValidationIssue,
  automationDefinitionSchema,
  type EmailSequenceProposal,
  emailSequenceProposalSchema,
  validateAutomation,
  validateEmailSequenceProposal,
} from "@openengage/core/automations";
import { type SegmentFilter, segmentFilterSchema } from "@openengage/core/segments";
import { formatIssuePath } from "@openengage/core/shared";

export interface ValidationIssue {
  phase: "schema" | "graph" | "sequence";
  code: string;
  path: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export type SegmentFilterValidationResult =
  | { valid: true; normalized: SegmentFilter; issues: [] }
  | { valid: false; issues: ValidationIssue[] };

export type AutomationDefinitionValidationResult =
  | { valid: true; normalized: AutomationDefinition; issues: [] }
  | { valid: false; issues: ValidationIssue[]; normalized?: AutomationDefinition };

export type EmailSequenceProposalValidationResult =
  | { valid: true; normalized: EmailSequenceProposal; issues: [] }
  | { valid: false; issues: ValidationIssue[]; normalized?: EmailSequenceProposal };

export function validateSegmentFilterInput(filter: unknown): SegmentFilterValidationResult {
  const parsed = segmentFilterSchema.safeParse(filter);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        phase: "schema",
        code: issue.code,
        path: formatIssuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  return { valid: true, normalized: parsed.data, issues: [] };
}

export function validateAutomationDefinitionInput(
  definition: unknown,
): AutomationDefinitionValidationResult {
  const parsed = automationDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        phase: "schema",
        code: issue.code,
        path: formatIssuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const graphIssues = validateAutomation(parsed.data);
  if (graphIssues.length > 0) {
    return {
      valid: false,
      normalized: parsed.data,
      issues: graphIssues.map((issue) => formatGraphIssue(parsed.data, issue)),
    };
  }

  return { valid: true, normalized: parsed.data, issues: [] };
}

export function validateEmailSequenceProposalInput(
  proposal: unknown,
): EmailSequenceProposalValidationResult {
  const parsed = emailSequenceProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        phase: "schema",
        code: issue.code,
        path: formatIssuePath(issue.path),
        message: issue.message,
      })),
    };
  }
  const issues = validateEmailSequenceProposal(parsed.data);
  if (issues.length > 0) {
    return {
      valid: false,
      normalized: parsed.data,
      issues: issues.map((issue) => ({
        phase: "sequence",
        code: issue.code,
        path: issue.emailRef ? `$.emails[${JSON.stringify(issue.emailRef)}]` : "$",
        message: issue.message,
        ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
      })),
    };
  }
  return { valid: true, normalized: parsed.data, issues: [] };
}

export const validateSegmentFilterTool = defineTool({
  name: "validate_segment_filter",
  description:
    "Validate a proposed dynamic OpenEngage SegmentFilter with the canonical core schema. Returns normalized JSON or path-specific schema issues. It does not read or write contacts, segments, or any external system.",
  input: v.object({ filter: v.unknown() }),
  run({ data }) {
    return { output: toJsonValue(validateSegmentFilterInput(data.filter)) };
  },
});

export const validateAutomationDefinitionTool = defineTool({
  name: "validate_automation_definition",
  description:
    "Validate a proposed OpenEngage AutomationDefinition with the canonical core schema and graph rules. Returns normalized JSON or schema/graph issues. It does not verify resource IDs or write to OpenEngage.",
  input: v.object({ definition: v.unknown() }),
  run({ data }) {
    return { output: toJsonValue(validateAutomationDefinitionInput(data.definition)) };
  },
});

export const validateEmailSequenceProposalTool = defineTool({
  name: "validate_email_sequence_proposal",
  description:
    "Validate an OpenEngage email sequence proposal, including EmailDocumentV2 drafts, template references, capability classification, and its AutomationDefinition. It does not verify workspace resources or write data.",
  input: v.object({ proposal: v.unknown() }),
  run({ data }) {
    return { output: toJsonValue(validateEmailSequenceProposalInput(data.proposal)) };
  },
});

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function formatGraphIssue(
  definition: AutomationDefinition,
  issue: AutomationValidationIssue,
): ValidationIssue {
  const nodeIndex = issue.nodeId
    ? definition.nodes.findIndex((node) => node.id === issue.nodeId)
    : -1;
  const edgeIndex = issue.edgeId
    ? definition.edges.findIndex((edge) => edge.id === issue.edgeId)
    : -1;
  const path =
    edgeIndex >= 0 ? `$.edges[${edgeIndex}]` : nodeIndex >= 0 ? `$.nodes[${nodeIndex}]` : "$";

  return {
    phase: "graph",
    code: issue.code,
    path,
    message: issue.message,
    ...(issue.nodeId === undefined ? {} : { nodeId: issue.nodeId }),
    ...(issue.edgeId === undefined ? {} : { edgeId: issue.edgeId }),
  };
}
