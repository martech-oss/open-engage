CREATE TABLE `project_brief_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`decision` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_brief_reviews_decision_check" CHECK("project_brief_reviews"."decision" IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `project_brief_reviews_workspace_project_idx` ON `project_brief_reviews` (`workspace_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_briefs` (
	`project_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`owner_user_id` text NOT NULL,
	`approver_user_id` text NOT NULL,
	`primary_motion` text NOT NULL,
	`review_at` text NOT NULL,
	`definition` text NOT NULL,
	`submitted_at` text,
	`approved_at` text,
	`approved_by_user_id` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_briefs_status_check" CHECK("project_briefs"."status" IN ('draft', 'pending_approval', 'approved', 'completed')),
	CONSTRAINT "project_briefs_motion_check" CHECK("project_briefs"."primary_motion" IN ('acquisition', 'onboarding', 'engagement', 'retention', 'reactivation', 'measurement')),
	CONSTRAINT "project_briefs_revision_check" CHECK("project_briefs"."revision" >= 1),
	CONSTRAINT "project_briefs_distinct_reviewers_check" CHECK("project_briefs"."owner_user_id" != "project_briefs"."approver_user_id")
);
--> statement-breakpoint
CREATE INDEX `project_briefs_workspace_status_review_idx` ON `project_briefs` (`workspace_id`,`status`,`review_at`);--> statement-breakpoint
CREATE INDEX `project_briefs_workspace_owner_idx` ON `project_briefs` (`workspace_id`,`owner_user_id`);--> statement-breakpoint
ALTER TABLE `project_items` ADD `brief_revision` integer;--> statement-breakpoint
ALTER TABLE `project_items` ADD `added_by_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `archived_at` text;