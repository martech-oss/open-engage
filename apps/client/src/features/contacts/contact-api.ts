import {
  type QueryClient,
  keepPreviousData,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { orpc, orpcQuery } from "@/lib/orpc";
import type {
  ContactBulkAction,
  ContactDataJob,
  ContactExportFilter,
  ContactListInput,
  ContactOptions,
  ContactScoreAdjust,
  ContactUpdate,
  SegmentOption,
} from "@openengage/core/contacts";

export type { ContactOptions, SegmentOption };

export type ContactStatus = "active" | "archived" | "anonymous" | "all";
export type ContactSort = "updatedAt" | "createdAt" | "score" | "name" | "email";

export interface ContactSearch {
  q: string;
  status: ContactStatus;
  stage: string;
  tagId: string;
  companyId: string;
  segmentId: string;
  scoreMin: string;
  scoreMax: string;
  sort: ContactSort;
  direction: "asc" | "desc";
}

export const contactSearchDefaults: ContactSearch = {
  q: "",
  status: "active",
  stage: "",
  tagId: "",
  companyId: "",
  segmentId: "",
  scoreMin: "",
  scoreMax: "",
  sort: "updatedAt",
  direction: "desc",
};

const contactStatuses = new Set<ContactStatus>(["active", "archived", "anonymous", "all"]);
const contactSorts = new Set<ContactSort>(["updatedAt", "createdAt", "score", "name", "email"]);

export function parseContactSearch(search: Record<string, unknown>): ContactSearch {
  const status =
    typeof search.status === "string" && contactStatuses.has(search.status as ContactStatus)
      ? (search.status as ContactStatus)
      : contactSearchDefaults.status;
  const sort =
    typeof search.sort === "string" && contactSorts.has(search.sort as ContactSort)
      ? (search.sort as ContactSort)
      : contactSearchDefaults.sort;
  const direction = search.direction === "asc" ? "asc" : "desc";
  const stringValue = (key: keyof ContactSearch): string =>
    typeof search[key] === "string" ? search[key] : "";

  return {
    q: stringValue("q"),
    status,
    stage: stringValue("stage"),
    tagId: stringValue("tagId"),
    companyId: stringValue("companyId"),
    segmentId: stringValue("segmentId"),
    scoreMin: stringValue("scoreMin"),
    scoreMax: stringValue("scoreMax"),
    sort,
    direction,
  };
}

/** Contacts are paginated 50 at a time via cursor, not fetched all-at-once. */
export const CONTACTS_PAGE_SIZE = 50;

export function buildContactSearchInput(search: ContactSearch, cursor?: string): ContactListInput {
  const query = search.q.trim();
  const scoreMin = optionalNumber(search.scoreMin);
  const scoreMax = optionalNumber(search.scoreMax);

  return {
    limit: CONTACTS_PAGE_SIZE,
    status: search.status,
    sort: search.sort,
    direction: search.direction,
    ...(cursor ? { cursor } : {}),
    ...(query ? { query } : {}),
    ...(search.stage ? { stage: search.stage } : {}),
    ...(search.tagId ? { tagId: search.tagId } : {}),
    ...(search.companyId ? { companyId: search.companyId } : {}),
    ...(search.segmentId ? { segmentId: search.segmentId } : {}),
    ...(scoreMin === undefined ? {} : { scoreMin }),
    ...(scoreMax === undefined ? {} : { scoreMax }),
  };
}

/** Normalizes active filters without leaking list paging or sort state. */
export function buildContactExportFilter(search: ContactSearch): ContactExportFilter {
  const query = search.q.trim();
  const scoreMin = optionalNumber(search.scoreMin);
  const scoreMax = optionalNumber(search.scoreMax);
  return {
    status: search.status,
    ...(query ? { query } : {}),
    ...(search.stage ? { stage: search.stage } : {}),
    ...(search.tagId ? { tagId: search.tagId } : {}),
    ...(search.companyId ? { companyId: search.companyId } : {}),
    ...(search.segmentId ? { segmentId: search.segmentId } : {}),
    ...(scoreMin === undefined ? {} : { scoreMin }),
    ...(scoreMax === undefined ? {} : { scoreMax }),
  };
}

export function startContactExport(input: { filter: ContactExportFilter }) {
  return orpc.contacts.startExport(input);
}

export function getContactDataJob(jobId: string): Promise<ContactDataJob> {
  return orpc.contacts.getDataJob({ id: jobId });
}

export function downloadContactExport(jobId: string): Promise<File> {
  return orpc.contacts.downloadExport({ id: jobId });
}

export function contactsQueryOptions(search: ContactSearch, cursor?: string) {
  return orpcQuery.contacts.list.queryOptions({
    input: buildContactSearchInput(search, cursor),
    placeholderData: keepPreviousData,
  });
}

export function contactOptionsQueryOptions() {
  return orpcQuery.contacts.options.queryOptions();
}

export function invalidateContactsList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: orpcQuery.contacts.list.key({ type: "query" }),
  });
}

export function invalidateContactOptions(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: orpcQuery.contacts.options.key() });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.contacts.create.mutationOptions(),
    onSuccess: (_contact, variables) => invalidateCreatedContactQueries(queryClient, variables),
  });
}

/** Refreshes every read model affected by the single atomic create command. */
export function invalidateCreatedContactQueries(
  queryClient: QueryClient,
  relations: { companyId?: string | undefined; segmentId?: string | undefined },
): Promise<void> {
  return Promise.all([
    invalidateContactsList(queryClient),
    invalidateContactOptions(queryClient),
    ...(relations.companyId
      ? [
          queryClient.invalidateQueries({ queryKey: orpcQuery.companies.list.key() }),
          queryClient.invalidateQueries({
            queryKey: orpcQuery.companies.get.key({ input: { id: relations.companyId } }),
          }),
        ]
      : []),
    ...(relations.segmentId
      ? [
          queryClient.invalidateQueries({ queryKey: orpcQuery.segments.list.key() }),
          queryClient.invalidateQueries({
            queryKey: orpcQuery.segments.get.key({ input: { id: relations.segmentId } }),
          }),
        ]
      : []),
  ]).then(() => undefined);
}

export function contactProfileQueryOptions(contactId: string) {
  return orpcQuery.contacts.profile.queryOptions({ input: { contactId } });
}

export function archiveContact(contactId: string) {
  return orpc.contacts.archive({ id: contactId });
}

export function restoreContact(contactId: string) {
  return orpc.contacts.restore({ id: contactId });
}

export function updateContact(contactId: string, input: ContactUpdate) {
  return orpc.contacts.update({ id: contactId, ...input });
}

export function adjustContactScore(contactId: string, input: ContactScoreAdjust) {
  return orpc.contacts.adjustScore({ contactId, ...input });
}

export function assignContactTag(contactId: string, resourceId: string) {
  return orpc.contacts.assignTag({ contactId, resourceId });
}

export function removeContactTag(contactId: string, resourceId: string) {
  return orpc.contacts.removeTag({ contactId, resourceId });
}

export function addContactToSegment(contactId: string, resourceId: string) {
  return orpc.contacts.addToSegment({ contactId, resourceId });
}

export function removeContactFromSegment(contactId: string, resourceId: string) {
  return orpc.contacts.removeFromSegment({ contactId, resourceId });
}

export function bulkUpdateContacts(input: ContactBulkAction) {
  return orpc.contacts.bulkUpdate(input);
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
