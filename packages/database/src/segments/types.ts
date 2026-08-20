import { type SegmentFilter } from "@openengage/core/segments";

import { segments } from "./schema";

export type SegmentRecord = Omit<typeof segments.$inferSelect, "filterAst"> & {
  filterAst: SegmentFilter | null;
};
