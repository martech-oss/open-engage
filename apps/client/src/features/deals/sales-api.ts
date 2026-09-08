import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";

export const assignmentGroupsQueryOptions = () => orpcQuery.deals.assignmentGroups.queryOptions();
export const notificationsQueryOptions = () =>
  orpcQuery.deals.notifications.queryOptions({ input: {} });
export const contactTasksQueryOptions = (contactId: string) =>
  orpcQuery.deals.contactTasks.queryOptions({ input: { contactId } });
function useSalesInvalidation() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: orpcQuery.deals.key() }),
      client.invalidateQueries({ queryKey: orpcQuery.contacts.key() }),
      client.invalidateQueries({ queryKey: orpcQuery.segments.key() }),
    ]);
}
export function useSalesHandoff() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.handoff.mutationOptions({ onSuccess }));
}
export function useSaveAssignmentGroup() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.saveAssignmentGroup.mutationOptions({ onSuccess }));
}
export function useDeleteAssignmentGroup() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.deleteAssignmentGroup.mutationOptions({ onSuccess }));
}
export function useReadNotification() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.readNotification.mutationOptions({ onSuccess }));
}
export function useCreateContactTask() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.createContactTask.mutationOptions({ onSuccess }));
}
export function useSetTaskStatus() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.setTaskStatus.mutationOptions({ onSuccess }));
}

export const salesMembersQueryOptions = () => orpcQuery.deals.salesMembers.queryOptions();

export function useUpdateTaskResource() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.updateTaskResource.mutationOptions({ onSuccess }));
}
export function useDeleteTaskResource() {
  const onSuccess = useSalesInvalidation();
  return useMutation(orpcQuery.deals.deleteTaskResource.mutationOptions({ onSuccess }));
}
