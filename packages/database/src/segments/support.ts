import { sql, type SQL } from "drizzle-orm";

import { segmentFilterSchema, type CompiledSegment } from "@openengage/core/segments";

import { defineJsonCodec } from "../shared/json-codec";
import { segmentMemberships, segments } from "./schema";

export const filterAstCodec = defineJsonCodec(segmentFilterSchema, "segments.filter_ast");

export function memberCountExpression(): SQL<number> {
  return sql<number>`(SELECT COUNT(*) FROM ${segmentMemberships}
    WHERE ${segmentMemberships.workspaceId} = ${segments.workspaceId}
      AND ${segmentMemberships.segmentId} = ${segments.id})`;
}

export function compiledFilterSql(compiled: CompiledSegment): SQL {
  const parts = compiled.sql.split("?");
  if (parts.length !== compiled.params.length + 1) {
    throw new Error(
      `Compiled segment filter placeholder mismatch: expected ${parts.length - 1}, received ${compiled.params.length}`,
    );
  }
  const chunks: SQL[] = [];
  for (const [index, part] of parts.entries()) {
    if (part) chunks.push(sql.raw(part));
    if (index < compiled.params.length) chunks.push(sql`${compiled.params[index]}`);
  }
  return sql.join(chunks, sql.raw(""));
}
