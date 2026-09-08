CREATE TABLE `contact_lifecycle_history` (
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`stage` text NOT NULL,
	`reached_at` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `contact_id`, `stage`),
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_lifecycle_stage_check" CHECK("contact_lifecycle_history"."stage" IN ('mql','sql','customer'))
);
--> statement-breakpoint
CREATE INDEX `contact_lifecycle_stage_time_idx` ON `contact_lifecycle_history` (`workspace_id`,`stage`,`reached_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`visitor_id` text,
	`email` text,
	`first_name` text,
	`last_name` text,
	`phone` text,
	`external_id` text,
	`stage` text DEFAULT 'lead' NOT NULL,
	`owner_user_id` text,
	`lifecycle_stage` text DEFAULT 'lead' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`grade_points` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contacts_lifecycle_check" CHECK("__new_contacts"."lifecycle_stage" IN ('lead','mql','sql','customer')),
	CONSTRAINT "contacts_status_check" CHECK("__new_contacts"."status" IN ('active', 'archived', 'anonymous'))
);
--> statement-breakpoint
INSERT INTO `__new_contacts`("id", "workspace_id", "visitor_id", "email", "first_name", "last_name", "phone", "external_id", "stage", "owner_user_id", "lifecycle_stage", "score", "grade_points", "status", "custom_fields", "created_at", "updated_at", "archived_at") SELECT "id", "workspace_id", "visitor_id", "email", "first_name", "last_name", "phone", "external_id", "stage", NULL, 'lead', "score", "grade_points", "status", "custom_fields", "created_at", "updated_at", "archived_at" FROM `contacts`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `__new_contacts` RENAME TO `contacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `contacts_workspace_status_updated_idx` ON `contacts` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `contacts_workspace_owner_lifecycle_idx` ON `contacts` (`workspace_id`,`owner_user_id`,`lifecycle_stage`);--> statement-breakpoint
CREATE INDEX `contacts_workspace_stage_idx` ON `contacts` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `contacts_workspace_score_idx` ON `contacts` (`workspace_id`,`score`);--> statement-breakpoint
CREATE INDEX `contacts_workspace_created_idx` ON `contacts` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_visitor_unique` ON `contacts` (`workspace_id`,`visitor_id`) WHERE "contacts"."visitor_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_external_unique` ON `contacts` (`workspace_id`,`external_id`) WHERE "contacts"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_email_unique` ON `contacts` (`workspace_id`,`email`) WHERE "contacts"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_id_unique` ON `contacts` (`workspace_id`,`id`);