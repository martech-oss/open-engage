import { useReducer, type Dispatch, type SetStateAction } from "react";

import { toDateTimeLocal } from "@/lib/format";
import {
  projectBriefDraftInputSchema,
  type ProjectBriefDraftInput,
} from "@openengage/core/projects";
import { workspaceDateTimeToUtc } from "@openengage/core/shared/time";

export type ProjectBriefFormDraft = Omit<ProjectBriefDraftInput, "reviewAt"> & {
  /**
   * Workspace wall time as typed into `datetime-local`, deliberately unparsed.
   * Converted to UTC only after validation succeeds, in the same timezone the
   * brief is displayed in.
   */
  reviewAt: string;
};

export type ProjectBriefFieldErrors = Record<string, string>;

type DraftAction =
  | { type: "set"; value: SetStateAction<ProjectBriefFormDraft> }
  | { type: "reset"; value: ProjectBriefFormDraft };

export function projectBriefDraftReducer(
  state: ProjectBriefFormDraft,
  action: DraftAction,
): ProjectBriefFormDraft {
  if (action.type === "reset") return action.value;
  return typeof action.value === "function" ? action.value(state) : action.value;
}

export function useProjectBriefDraft(initial: ProjectBriefFormDraft): {
  draft: ProjectBriefFormDraft;
  setDraft: Dispatch<SetStateAction<ProjectBriefFormDraft>>;
  resetDraft: (value: ProjectBriefFormDraft) => void;
} {
  const [draft, dispatch] = useReducer(projectBriefDraftReducer, initial);
  return {
    draft,
    setDraft: (value) => dispatch({ type: "set", value }),
    resetDraft: (value) => dispatch({ type: "reset", value }),
  };
}

export function emptyBrief(timeZone: string): ProjectBriefFormDraft {
  return {
    name: "",
    description: "",
    color: "#7c3aed",
    ownerUserId: "",
    approverUserId: "",
    primaryMotion: "onboarding",
    reviewAt: toDateTimeLocal(new Date(Date.now() + 14 * 86_400_000).toISOString(), timeZone),
    definition: {
      outcome: "",
      audience: "",
      lifecycleMoment: "",
      confidence: "low",
      entryTrigger: "",
      eligibility: [],
      exclusions: [],
      actions: [""],
      exitCondition: "",
      failureBehavior: "",
      consentRequirement: "",
      suppressionRules: "",
      frequencyPolicy: "",
      requiredData: [],
      requiredEvents: [],
      requiredContent: [],
      dependenciesAndApprovals: [],
      deliveryHorizon: "",
      measurement: {
        outcomeMetric: { name: "", proof: "" },
        earlySignal: { name: "", proof: "" },
        baseline: { kind: "unknown", discoveryTask: "" },
        successThreshold: "",
      },
      immediateNextSteps: [""],
      notIncluded: [],
      assumptions: [],
      followUpExperiment: null,
    },
  };
}

export function formDraftFromInput(
  value: ProjectBriefDraftInput,
  timeZone: string,
): ProjectBriefFormDraft {
  return { ...value, reviewAt: toDateTimeLocal(value.reviewAt, timeZone) };
}

export type ProjectBriefDraftValidation =
  | { success: true; data: ProjectBriefDraftInput; errors: ProjectBriefFieldErrors }
  | { success: false; errors: ProjectBriefFieldErrors };

export function validateProjectBriefDraft(
  draft: ProjectBriefFormDraft,
  timeZone: string,
): ProjectBriefDraftValidation {
  const reviewAt = reviewAtToUtc(draft.reviewAt, timeZone);
  if (!reviewAt) {
    return { success: false, errors: { reviewAt: "有効なレビュー日時を入力してください" } };
  }
  const parsed = projectBriefDraftInputSchema.safeParse({ ...draft, reviewAt });
  const errors: ProjectBriefFieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (path && !errors[path]) errors[path] = issue.message;
    }
  }
  if (draft.ownerUserId && draft.ownerUserId === draft.approverUserId) {
    errors.approverUserId = "担当者とは異なる承認者を選択してください";
  }
  return parsed.success && Object.keys(errors).length === 0
    ? { success: true, data: parsed.data, errors }
    : { success: false, errors };
}

export function errorAt(errors: ProjectBriefFieldErrors, path: string): string | undefined {
  return errors[path] ?? Object.entries(errors).find(([key]) => key.startsWith(`${path}.`))?.[1];
}

function reviewAtToUtc(value: string, timeZone: string): string | null {
  if (!value) return null;
  try {
    return workspaceDateTimeToUtc(value, timeZone);
  } catch {
    return null;
  }
}

/** Applies AI output only where the user has not edited that value since generation started. */
export function mergeAiProposalPreservingEdits(
  current: ProjectBriefFormDraft,
  beforeGeneration: ProjectBriefFormDraft,
  proposal: ProjectBriefFormDraft,
): ProjectBriefFormDraft {
  return mergeUnchanged(current, beforeGeneration, proposal) as ProjectBriefFormDraft;
}

function mergeUnchanged(current: unknown, before: unknown, proposal: unknown): unknown {
  if (Object.is(current, before)) return proposal;
  if (Array.isArray(current) || Array.isArray(before) || Array.isArray(proposal)) {
    return JSON.stringify(current) === JSON.stringify(before) ? proposal : current;
  }
  if (
    current &&
    before &&
    proposal &&
    typeof current === "object" &&
    typeof before === "object" &&
    typeof proposal === "object"
  ) {
    const result: Record<string, unknown> = { ...(current as Record<string, unknown>) };
    for (const key of Object.keys(proposal as Record<string, unknown>)) {
      result[key] = mergeUnchanged(
        (current as Record<string, unknown>)[key],
        (before as Record<string, unknown>)[key],
        (proposal as Record<string, unknown>)[key],
      );
    }
    return result;
  }
  return current === before ? proposal : current;
}
