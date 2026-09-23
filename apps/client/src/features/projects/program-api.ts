import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";
import { invalidateQueryRoots } from "@/lib/query-invalidation";
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
/** Program writes change projects, the contacts they enroll and segment memberships. */
function invalidateProgramQueries(queryClient: QueryClient) {
  return invalidateQueryRoots(
    queryClient,
    orpcQuery.projects.key(),
    orpcQuery.contacts.key(),
    orpcQuery.segments.key(),
  );
}
export function useProgramInvalidator() {
  const queryClient = useQueryClient();
  return useCallback(() => invalidateProgramQueries(queryClient), [queryClient]);
}
export function useCreateProject() {
  return useInvalidatingMutation(
    orpcQuery.projects.create.mutationOptions(),
    invalidateProgramQueries,
  );
}
export function useSaveProgram() {
  return useInvalidatingMutation(
    orpcQuery.projects.programSave.mutationOptions(),
    invalidateProgramQueries,
  );
}
export function usePublishProgram() {
  return useInvalidatingMutation(
    orpcQuery.projects.programPublish.mutationOptions(),
    invalidateProgramQueries,
  );
}
export function useMutateProjectMember() {
  return useInvalidatingMutation(
    orpcQuery.projects.memberMutate.mutationOptions(),
    invalidateProgramQueries,
  );
}
export function useImportProjectMembers() {
  return useInvalidatingMutation(
    orpcQuery.projects.memberImport.mutationOptions(),
    invalidateProgramQueries,
  );
}
export function useBindProgramForm() {
  return useInvalidatingMutation(
    orpcQuery.projects.programBindForm.mutationOptions(),
    invalidateProgramQueries,
  );
}

export function programMemberImportQueryOptions(id: string, jobId: string) {
  return orpcQuery.projects.memberImportGet.queryOptions({ input: { id, jobId } });
}
