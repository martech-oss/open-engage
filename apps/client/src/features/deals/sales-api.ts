import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpcQuery } from "@/lib/orpc";

export const assignmentGroupsQueryOptions = () => orpcQuery.deals.assignmentGroups.queryOptions();
export const notificationsQueryOptions = () =>
  orpcQuery.deals.notifications.queryOptions({ input: {} });
export const contactTasksQueryOptions = (contactId: string) =>
  orpcQuery.deals.contactTasks.queryOptions({ input: { contactId } });
/** Handoffs and tasks change deals, the contact's owner and lifecycle, and segment memberships. */
const SALES_WRITE_ROOTS = [
  orpcQuery.deals.key(),
  orpcQuery.contacts.key(),
  orpcQuery.segments.key(),
];
export function useSalesHandoff() {
  return useInvalidatingMutation(orpcQuery.deals.handoff.mutationOptions(), SALES_WRITE_ROOTS);
}
export function useSaveAssignmentGroup() {
  return useInvalidatingMutation(orpcQuery.deals.saveAssignmentGroup.mutationOptions(), [
    orpcQuery.deals.assignmentGroups.key(),
  ]);
}
export function useDeleteAssignmentGroup() {
  return useInvalidatingMutation(orpcQuery.deals.deleteAssignmentGroup.mutationOptions(), [
    orpcQuery.deals.assignmentGroups.key(),
  ]);
}
export function useReadNotification() {
  return useInvalidatingMutation(orpcQuery.deals.readNotification.mutationOptions(), [
    orpcQuery.deals.notifications.key(),
  ]);
}
export function useCreateContactTask() {
  return useInvalidatingMutation(
    orpcQuery.deals.createContactTask.mutationOptions(),
    SALES_WRITE_ROOTS,
  );
}
export function useSetTaskStatus() {
  return useInvalidatingMutation(
    orpcQuery.deals.setTaskStatus.mutationOptions(),
    SALES_WRITE_ROOTS,
  );
}

export const salesMembersQueryOptions = () => orpcQuery.deals.salesMembers.queryOptions();

export function useUpdateTaskResource() {
  return useInvalidatingMutation(
    orpcQuery.deals.updateTaskResource.mutationOptions(),
    SALES_WRITE_ROOTS,
  );
}
export function useDeleteTaskResource() {
  return useInvalidatingMutation(
    orpcQuery.deals.deleteTaskResource.mutationOptions(),
    SALES_WRITE_ROOTS,
  );
}
