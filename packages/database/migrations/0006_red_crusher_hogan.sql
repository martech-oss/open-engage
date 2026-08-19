CREATE TABLE `custom_redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`destination_url` text NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `custom_redirects_workspace_updated_idx` ON `custom_redirects` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_redirects_workspace_slug_unique` ON `custom_redirects` (`workspace_id`,`slug`);