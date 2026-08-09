CREATE TABLE `email_brand_profiles` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`brand_name` text DEFAULT '' NOT NULL,
	`company_description` text DEFAULT '' NOT NULL,
	`tone` text DEFAULT '' NOT NULL,
	`logo_asset_id` text,
	`website_url` text,
	`primary_color` text DEFAULT '#171717' NOT NULL,
	`background_color` text DEFAULT '#f4f5f7' NOT NULL,
	`text_color` text DEFAULT '#171717' NOT NULL,
	`postal_address` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`logo_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `generated_email_images` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`request_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`claimed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generated_email_images_workspace_expiry_idx` ON `generated_email_images` (`workspace_id`,`claimed_at`,`expires_at`);