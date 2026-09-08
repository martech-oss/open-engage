CREATE TABLE `dynamic_contents` (
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`fallback_html` text NOT NULL,
	`rules` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `page_id`, `slot_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `landing_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `experiment_exposures` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`experiment_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`page_version_id` text NOT NULL,
	`exposed_at` text,
	`converted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_version_id`) REFERENCES `landing_page_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`experiment_id`) REFERENCES `landing_experiments`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`visitor_id`) REFERENCES `site_visitors`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_exposures_visitor_unique` ON `experiment_exposures` (`workspace_id`,`experiment_id`,`visitor_id`);--> statement-breakpoint
CREATE INDEX `experiment_exposures_cohort_idx` ON `experiment_exposures` (`workspace_id`,`experiment_id`,`exposed_at`);--> statement-breakpoint
CREATE TABLE `landing_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`variants` text NOT NULL,
	`winner_variant_id` text,
	`started_at` text,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `landing_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "landing_experiments_status_check" CHECK("landing_experiments"."status" IN ('draft','running','ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landing_experiments_workspace_id_unique` ON `landing_experiments` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `landing_experiments_one_running` ON `landing_experiments` (`workspace_id`,`page_id`) WHERE "landing_experiments"."status" = 'running';--> statement-breakpoint
CREATE INDEX `landing_experiments_workspace_page_idx` ON `landing_experiments` (`workspace_id`,`page_id`);