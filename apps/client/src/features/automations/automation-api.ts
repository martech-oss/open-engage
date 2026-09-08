import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";
import { invalidateProjectBriefQueries } from "@/lib/project-brief-cache";

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
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.create.mutationOptions(),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
        ...(variables.projectId ? [invalidateProjectBriefQueries(queryClient)] : []),
      ]);
    },
  });
}

export function useGenerateAutomation() {
  return useMutation(orpcQuery.automations.generate.mutationOptions());
}

export function useGenerateEmailSequence() {
  return useMutation(orpcQuery.automations.generateSequence.mutationOptions());
}

export function useApplyEmailSequence() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.applySequence.mutationOptions(),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
        queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() }),
        ...(variables.projectId ? [invalidateProjectBriefQueries(queryClient)] : []),
      ]);
    },
  });
}

/** Shared by the list page and the editor header, both of which only toggle active/paused. */
export function useSetAutomationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.setStatus.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
  });
}

export function useSaveAutomationDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.saveDraft.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
  });
}

export function usePublishAutomationDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.publish.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
  });
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
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.startRun.mutationOptions(),
    onSuccess: () => client.invalidateQueries({ queryKey: orpcQuery.automations.listRuns.key() }),
  });
}
export function useCancelAutomationRun() {
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.cancelRun.mutationOptions(),
    onSuccess: () => client.invalidateQueries({ queryKey: orpcQuery.automations.key() }),
  });
}
export function useCancelAutomationEnrollment() {
  const client = useQueryClient();
  return useMutation({
    ...orpcQuery.automations.cancelEnrollment.mutationOptions(),
    onSuccess: () => client.invalidateQueries({ queryKey: orpcQuery.automations.key() }),
  });
}

export function automationEnrollmentsQueryOptions(id: string) {
  return {
    ...orpcQuery.automations.listEnrollments.queryOptions({ input: { id } }),
    refetchInterval: 5000,
  };
}
