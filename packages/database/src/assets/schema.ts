import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import {
  ASSET_CHECKSUM_ALGORITHMS,
  ASSET_KINDS,
  ASSET_VISIBILITIES,
} from "@openengage/core/shared";

import { organization, user } from "../auth/schema";
import { checkEnum } from "../shared/enum-check";

export const assets = sqliteTable(
  "assets",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Editable display name. The R2 key is derived from `originalFilename`, not this. */
    name: text().notNull(),
    originalFilename: text("original_filename").notNull(),
    kind: text().default("other").notNull(),
    description: text().default("").notNull(),
    altText: text("alt_text").default("").notNull(),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer().notNull(),
    /**
     * Content fingerprint for cache-busting and duplicate detection, not an
     * integrity attestation - see `checksumAlgorithm`.
     */
    checksum: text().notNull(),
    checksumAlgorithm: text("checksum_algorithm").default("sha256").notNull(),
    /** Images only; measured client-side because Workers have no image decoder. */
    width: integer(),
    height: integer(),
    visibility: text().default("private").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assets_workspace_archived_created_idx").on(
      table.workspaceId,
      table.archivedAt,
      table.createdAt,
    ),
    uniqueIndex("assets_workspace_key_unique").on(table.workspaceId, table.r2Key),
    checkEnum("assets_kind_check", table.kind, ASSET_KINDS),
    checkEnum("assets_visibility_check", table.visibility, ASSET_VISIBILITIES),
    checkEnum(
      "assets_checksum_algorithm_check",
      table.checksumAlgorithm,
      ASSET_CHECKSUM_ALGORITHMS,
    ),
  ],
);
