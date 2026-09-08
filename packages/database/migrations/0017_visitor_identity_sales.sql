CREATE TABLE `site_visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_visitors_workspace_id_unique` ON `site_visitors` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `visitor_bindings` (
	`workspace_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`history_status` text DEFAULT 'pending' NOT NULL,
	`lease_id` text,
	`lease_expires_at` text,
	PRIMARY KEY(`workspace_id`, `visitor_id`),
	FOREIGN KEY (`workspace_id`,`visitor_id`) REFERENCES `site_visitors`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "visitor_bindings_history_check" CHECK("visitor_bindings"."history_status" IN ('pending','done'))
);
--> statement-breakpoint
CREATE INDEX `visitor_bindings_contact_idx` ON `visitor_bindings` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `visitor_bindings_history_idx` ON `visitor_bindings` (`history_status`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `app_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`title` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_notifications_user_idx` ON `app_notifications` (`workspace_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assignment_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`user_ids` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assignment_groups_workspace_idx` ON `assignment_groups` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `sales_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`execution_key` text NOT NULL,
	`contact_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_handoffs_execution_unique` ON `sales_handoffs` (`workspace_id`,`execution_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deal_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`deal_id` text,
	`contact_id` text,
	`type` text DEFAULT 'task' NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_user_id` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deal_tasks_link_check" CHECK("__new_deal_tasks"."deal_id" IS NOT NULL OR "__new_deal_tasks"."contact_id" IS NOT NULL),
	CONSTRAINT "deal_tasks_type_check" CHECK("__new_deal_tasks"."type" IN ('task', 'call', 'email', 'meeting')),
	CONSTRAINT "deal_tasks_status_check" CHECK("__new_deal_tasks"."status" IN ('open', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_deal_tasks`("id", "workspace_id", "deal_id", "contact_id", "type", "title", "notes", "due_at", "status", "assigned_user_id", "completed_at", "created_at", "updated_at") SELECT "id", "workspace_id", "deal_id", NULL, "type", "title", "notes", "due_at", "status", "assigned_user_id", "completed_at", "created_at", "updated_at" FROM `deal_tasks`;--> statement-breakpoint
DROP TABLE `deal_tasks`;--> statement-breakpoint
ALTER TABLE `__new_deal_tasks` RENAME TO `deal_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_deal_status_idx` ON `deal_tasks` (`workspace_id`,`deal_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_assignee_idx` ON `deal_tasks` (`workspace_id`,`assigned_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_status_completed_idx` ON `deal_tasks` (`workspace_id`,`status`,`completed_at`);--> statement-breakpoint
ALTER TABLE `contact_events` ADD `replay_mode` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `visitor_id` text;