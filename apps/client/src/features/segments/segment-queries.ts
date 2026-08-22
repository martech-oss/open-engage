import { orpcQuery } from "@/lib/orpc";

export function segmentsQueryOptions(kind?: "static" | "dynamic") {
  return orpcQuery.segments.list.queryOptions({ input: kind ? { kind } : {} });
}

export function segmentQueryOptions(segmentId: string) {
  return orpcQuery.segments.get.queryOptions({ input: { id: segmentId } });
}

export function segmentOptionsQueryOptions() {
  return orpcQuery.segments.options.queryOptions();
}

/** Active contacts offered when adding one to a static list. */
export function listMemberOptionsQueryOptions() {
  return orpcQuery.contacts.list.queryOptions({
    input: { limit: 100, status: "active", sort: "name", direction: "asc" },
  });
}
