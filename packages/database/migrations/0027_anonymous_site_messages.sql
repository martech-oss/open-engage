ALTER TABLE `site_messages` ADD `audience` text DEFAULT 'identified' NOT NULL;--> statement-breakpoint
ALTER TABLE `site_messages` ADD `frequency` text DEFAULT 'session' NOT NULL;