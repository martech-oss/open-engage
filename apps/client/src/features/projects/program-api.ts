import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { orpcQuery } from "@/lib/orpc";
import type { ProgramCohortInput } from "@openengage/core/projects";
export function projectsQueryOptions() {
  return orpcQuery.projects.programCatalog.queryOptions();
}
export function programQueryOptions(id: string) {
  return orpcQuery.projects.programGet.queryOptions({ input: { id } });
}
export function projectMembersQueryOptions(id: string, query = "", offset = 0, statusId = "") {
  return orpcQuery.projects.memberList.queryOptions({
    input: { id, query, offset, ...(statusId ? { statusId } : {}) },
  });
}
export function projectMemberHistoryQueryOptions(id: string, contactId: string) {
  return orpcQuery.projects.memberHistory.queryOptions({ input: { id, contactId } });
}
export function programCohortQueryOptions(id: string, cohort: ProgramCohortInput) {
  return orpcQuery.projects.programCohort.queryOptions({ input: { id, ...cohort } });
}
export function useProgramInvalidator() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: orpcQuery.projects.key() }),
        client.invalidateQueries({ queryKey: orpcQuery.contacts.key() }),
        client.invalidateQueries({ queryKey: orpcQuery.segments.key() }),
      ]),
    [client],
  );
}
export function useCreateProject() {
  return useMutation({
    ...orpcQuery.projects.create.mutationOptions(),
    onSuccess: useProgramInvalidator(),
  });
}
export function useSaveProgram() {
  return useMutation({
    ...orpcQuery.projects.programSave.mutationOptions(),
    onSuccess: useProgramInvalidator(),
  });
}
export function usePublishProgram() {
  return useMutation({
    ...orpcQuery.projects.programPublish.mutationOptions(),
    onSuccess: useProgramInvalidator(),
  });
}
export function useMutateProjectMember() {
  return useMutation({
    ...orpcQuery.projects.memberMutate.mutationOptions(),
    onSuccess: useProgramInvalidator(),
  });
}
export function useImportProjectMembers() {
  return useMutation({
    ...orpcQuery.projects.memberImport.mutationOptions(),
    onSuccess: useProgramInvalidator(),
  });
}
export function useBindProgramForm() {
  return useMutation({
    ...orpcQuery.projects.programBindForm.mutationOptions(),
    onSuccess: useProgramInvalidator(),
  });
}

export function programMemberImportQueryOptions(id: string, jobId: string) {
  return orpcQuery.projects.memberImportGet.queryOptions({ input: { id, jobId } });
}
