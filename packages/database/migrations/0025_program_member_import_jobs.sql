CREATE TABLE `program_member_import_rows` (
	`job_id` text NOT NULL,
	`row` integer NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`job_id`, `row`),
	FOREIGN KEY (`job_id`) REFERENCES `program_member_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `program_member_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`request_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`csv` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`status` text NOT NULL,
	`total` integer NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`lease_id` text,
	`lease_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `program_member_import_request` ON `program_member_imports` (`workspace_id`,`project_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `program_member_import_recovery` ON `program_member_imports` (`status`,`lease_until`,`updated_at`);