import { useMutation } from "@tanstack/react-query";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
import { invalidateProjectBriefQueries } from "@/lib/project-brief-cache";
import { invalidateQueryRoots } from "@/lib/query-invalidation";

export function automationsQueryOptions() {
  return orpcQuery.automations.list.queryOptions();
}

export function automationDraftQueryOptions(id: string) {
  return orpcQuery.automations.getDraft.queryOptions({ input: { id } });
}

export function formOptionsQueryOptions() {
  return orpcQuery.website.listForms.queryOptions();
}

export function segmentOptionsQueryOptions() {
  return orpcQuery.emails.listSegmentOptions.queryOptions();
}

export function useCreateAutomation() {
  return useInvalidatingMutation(
    orpcQuery.automations.create.mutationOptions(),
    (queryClient, variables) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
        ...(variables.projectId ? [invalidateProjectBriefQueries(queryClient)] : []),
      ]),
  );
}

export function useGenerateAutomation() {
  return useMutation(orpcQuery.automations.generate.mutationOptions());
}

export function useGenerateEmailSequence() {
  return useMutation(orpcQuery.automations.generateSequence.mutationOptions());
}

export function useApplyEmailSequence() {
  return useInvalidatingMutation(
    orpcQuery.automations.applySequence.mutationOptions(),
    (queryClient, variables) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
        queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() }),
        ...(variables.projectId ? [invalidateProjectBriefQueries(queryClient)] : []),
      ]),
  );
}

/** Shared by the list page and the editor header, both of which only toggle active/paused. */
export function useSetAutomationStatus() {
  return useInvalidatingMutation(orpcQuery.automations.setStatus.mutationOptions(), [
    orpcQuery.automations.list.key(),
  ]);
}

export function useSaveAutomationDraft() {
  return useInvalidatingMutation(orpcQuery.automations.saveDraft.mutationOptions(), [
    orpcQuery.automations.list.key(),
  ]);
}

export function usePublishAutomationDraft() {
  return useInvalidatingMutation(
    orpcQuery.automations.publish.mutationOptions(),
    (queryClient, { id }) =>
      invalidateQueryRoots(
        queryClient,
        orpcQuery.automations.list.key(),
        automationDraftQueryOptions(id).queryKey,
      ),
  );
}

export function automationExecutionOptionsQueryOptions() {
  return orpcQuery.automations.executionOptions.queryOptions();
}
export function automationFilterCatalogQueryOptions() {
  return orpcQuery.segments.options.queryOptions();
}
export function automationStaticListsQueryOptions() {
  return orpcQuery.segments.list.queryOptions({ input: { kind: "static" } });
}
export function automationRunsQueryOptions(id: string) {
  return {
    ...orpcQuery.automations.listRuns.queryOptions({ input: { id } }),
    refetchInterval: 5000,
  };
}
export function automationRunDetailQueryOptions(id: string, runId: string, cursor?: string) {
  return {
    ...orpcQuery.automations.runDetail.queryOptions({
      input: { id, runId, ...(cursor ? { cursor } : {}) },
    }),
    refetchInterval: 5000,
  };
}
export function automationEnrollmentDetailQueryOptions(id: string, enrollmentId: string) {
  return {
    ...orpcQuery.automations.enrollmentDetail.queryOptions({ input: { id, enrollmentId } }),
    refetchInterval: 5000,
  };
}
export function usePreviewAutomationRun() {
  return useMutation(orpcQuery.automations.previewRun.mutationOptions());
}
export function useStartAutomationRun() {
  return useInvalidatingMutation(orpcQuery.automations.startRun.mutationOptions(), [
    orpcQuery.automations.listRuns.key(),
  ]);
}
export function useCancelAutomationRun() {
  return useInvalidatingMutation(orpcQuery.automations.cancelRun.mutationOptions(), [
    orpcQuery.automations.key(),
  ]);
}
export function useCancelAutomationEnrollment() {
  return useInvalidatingMutation(orpcQuery.automations.cancelEnrollment.mutationOptions(), [
    orpcQuery.automations.key(),
  ]);
}

export function automationEnrollmentsQueryOptions(id: string) {
  return {
    ...orpcQuery.automations.listEnrollments.queryOptions({ input: { id } }),
    refetchInterval: 5000,
  };
}
