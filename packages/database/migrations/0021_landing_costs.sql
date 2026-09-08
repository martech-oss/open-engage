CREATE TABLE `form_handlers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`form_id` text NOT NULL,
	`field_mapping` text NOT NULL,
	`allowed_domains` text NOT NULL,
	`success_url` text NOT NULL,
	`failure_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_handlers_workspace_slug_unique` ON `form_handlers` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `form_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`form_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`allowed_domains` text NOT NULL,
	`turnstile_enabled` integer NOT NULL,
	`success_message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_versions_workspace_form_version_unique` ON `form_versions` (`workspace_id`,`form_id`,`version`);--> statement-breakpoint
CREATE TABLE `landing_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`base_version_id` text NOT NULL,
	`request_key` text NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`result_version_id` text,
	`explanation` text,
	`error` text,
	`lease_id` text,
	`lease_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `landing_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "landing_generation_status_check" CHECK("landing_generation_jobs"."status" IN ('queued','running','completed','failed','conflict'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landing_generation_jobs_request_unique` ON `landing_generation_jobs` (`workspace_id`,`page_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `landing_generation_jobs_recovery_idx` ON `landing_generation_jobs` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `campaign_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`booked_on` text NOT NULL,
	`category` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "campaign_costs_amount_check" CHECK("campaign_costs"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `campaign_costs_workspace_date_currency_idx` ON `campaign_costs` (`workspace_id`,`booked_on`,`currency`);--> statement-breakpoint
ALTER TABLE `landing_page_versions` ADD `document` text;--> statement-breakpoint
ALTER TABLE `landing_page_versions` ADD `form_bindings` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `landing_pages` ADD `published_version_id` text;