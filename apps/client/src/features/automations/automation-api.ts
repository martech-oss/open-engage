import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() }),
  });
}

export function useGenerateAutomation() {
  return useMutation(orpcQuery.automations.generate.mutationOptions());
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
