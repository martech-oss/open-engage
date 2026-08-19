CREATE TABLE `email_tracking_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`open_tracking_enabled` integer DEFAULT false NOT NULL,
	`click_tracking_enabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
