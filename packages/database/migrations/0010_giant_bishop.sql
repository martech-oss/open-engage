CREATE TABLE `contact_event_outbox` (
	`event_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`lease_id` text,
	`lease_expires_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `contact_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_event_outbox_status_check" CHECK("contact_event_outbox"."status" IN ('pending', 'processing', 'processed'))
);
--> statement-breakpoint
CREATE INDEX `contact_event_outbox_workspace_status_idx` ON `contact_event_outbox` (`workspace_id`,`status`,`created_at`);