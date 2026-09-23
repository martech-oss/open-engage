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
