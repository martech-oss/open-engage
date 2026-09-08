CREATE UNIQUE INDEX `deals_workspace_id_unique` ON `deals` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deals_workspace_contact_unique` ON `deals` (`workspace_id`,`id`,`contact_id`);--> statement-breakpoint
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
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`deal_id`) REFERENCES `deals`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`deal_id`,`contact_id`) REFERENCES `deals`(`workspace_id`,`id`,`contact_id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "deal_tasks_link_check" CHECK("__new_deal_tasks"."deal_id" IS NOT NULL OR "__new_deal_tasks"."contact_id" IS NOT NULL),
	CONSTRAINT "deal_tasks_type_check" CHECK("__new_deal_tasks"."type" IN ('task', 'call', 'email', 'meeting')),
	CONSTRAINT "deal_tasks_status_check" CHECK("__new_deal_tasks"."status" IN ('open', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_deal_tasks`("id", "workspace_id", "deal_id", "contact_id", "type", "title", "notes", "due_at", "status", "assigned_user_id", "completed_at", "created_at", "updated_at") SELECT "id", "workspace_id", "deal_id", "contact_id", "type", "title", "notes", "due_at", "status", "assigned_user_id", "completed_at", "created_at", "updated_at" FROM `deal_tasks`;--> statement-breakpoint
DROP TABLE `deal_tasks`;--> statement-breakpoint
ALTER TABLE `__new_deal_tasks` RENAME TO `deal_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_deal_status_idx` ON `deal_tasks` (`workspace_id`,`deal_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_assignee_idx` ON `deal_tasks` (`workspace_id`,`assigned_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `deal_tasks_workspace_status_completed_idx` ON `deal_tasks` (`workspace_id`,`status`,`completed_at`);