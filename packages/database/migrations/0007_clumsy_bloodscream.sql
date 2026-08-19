CREATE TABLE `contact_category_scores` (
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`category_id` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `contact_id`, `category_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `scoring_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_category_scores_workspace_category_idx` ON `contact_category_scores` (`workspace_id`,`category_id`,`score`);--> statement-breakpoint
CREATE TABLE `grading_criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`field` text NOT NULL,
	`field_key` text,
	`operator` text NOT NULL,
	`value` text NOT NULL,
	`steps` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "grading_criteria_operator_check" CHECK("grading_criteria"."operator" IN ('eq', 'neq', 'contains', 'starts_with', 'in', 'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists'))
);
--> statement-breakpoint
CREATE INDEX `grading_criteria_workspace_idx` ON `grading_criteria` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `scoring_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_categories_workspace_slug_unique` ON `scoring_categories` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `scoring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`event_type` text NOT NULL,
	`match_type` text DEFAULT 'any' NOT NULL,
	`match_value` text,
	`points` integer DEFAULT 0 NOT NULL,
	`category_id` text,
	`tag_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `scoring_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "scoring_rules_event_type_check" CHECK("scoring_rules"."event_type" IN ('page_viewed', 'form_submitted', 'email_opened', 'email_clicked', 'email_replied', 'custom_redirect_clicked', 'custom_event')),
	CONSTRAINT "scoring_rules_match_type_check" CHECK("scoring_rules"."match_type" IN ('any', 'resource', 'url_exact', 'url_contains', 'url_starts_with'))
);
--> statement-breakpoint
CREATE INDEX `scoring_rules_workspace_event_idx` ON `scoring_rules` (`workspace_id`,`event_type`,`enabled`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `grade_points` integer DEFAULT 0 NOT NULL;