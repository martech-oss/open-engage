PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`filter_ast` text,
	`membership_source` text,
	`filter_version` integer DEFAULT 1 NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`evaluated_at` text,
	`evaluation_status` text DEFAULT 'ready' NOT NULL,
	`evaluation_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "segments_kind_check" CHECK("__new_segments"."kind" IN ('static', 'dynamic')),
	CONSTRAINT "segments_evaluation_status_check" CHECK("__new_segments"."evaluation_status" IN ('pending', 'running', 'ready', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_segments`("id", "workspace_id", "name", "slug", "description", "kind", "filter_ast", "membership_source", "filter_version", "member_count", "evaluated_at", "evaluation_status", "evaluation_error", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "slug", '', "kind", "filter_ast", NULL, 1, "member_count", "evaluated_at", 'ready', NULL, "created_at", "updated_at" FROM `segments`;--> statement-breakpoint
DROP TABLE `segments`;--> statement-breakpoint
ALTER TABLE `__new_segments` RENAME TO `segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `segments_workspace_updated_idx` ON `segments` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `segments_workspace_slug_unique` ON `segments` (`workspace_id`,`slug`);
