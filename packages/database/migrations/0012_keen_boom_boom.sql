CREATE TABLE `contact_event_projections` (
	`event_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`projection` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`event_id`, `projection`),
	FOREIGN KEY (`event_id`) REFERENCES `contact_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_event_projections_name_check" CHECK("contact_event_projections"."projection" IN ('scoring', 'grade', 'campaign', 'decision_wake', 'automation_enrollment', 'segment_reconcile')),
	CONSTRAINT "contact_event_projections_status_check" CHECK("contact_event_projections"."status" IN ('pending', 'completed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `contact_event_projections_workspace_status_idx` ON `contact_event_projections` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_action_effects` (
	`workspace_id` text NOT NULL,
	`job_id` text NOT NULL,
	`node_id` text NOT NULL,
	`effect` text NOT NULL,
	`completed_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `node_id`, `effect`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `automation_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_action_effects_workspace_completed_idx` ON `automation_action_effects` (`workspace_id`,`completed_at`);--> statement-breakpoint
ALTER TABLE `score_events` ADD `contact_event_id` text REFERENCES contact_events(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `score_events` ADD `scoring_rule_id` text REFERENCES scoring_rules(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `score_events_contact_event_rule_unique` ON `score_events` (`workspace_id`,`contact_event_id`,`scoring_rule_id`);--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `wait_event_type` text;--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `wait_resource_id` text;--> statement-breakpoint
CREATE INDEX `automation_jobs_wait_event_idx` ON `automation_jobs` (`status`,`workspace_id`,`contact_id`,`wait_event_type`,`wait_resource_id`);--> statement-breakpoint
ALTER TABLE `campaign_touches` ADD `source_event_id` text REFERENCES contact_events(id) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_touches_source_event_project_unique` ON `campaign_touches` (`workspace_id`,`source_event_id`,`project_id`);
--> statement-breakpoint
INSERT INTO `contact_event_projections`
  (`event_id`, `workspace_id`, `projection`, `status`, `created_at`, `completed_at`)
SELECT outbox.`event_id`, outbox.`workspace_id`, projections.value, 'pending', outbox.`created_at`, NULL
FROM `contact_event_outbox` AS outbox
CROSS JOIN json_each(
  '["scoring","grade","campaign","decision_wake","automation_enrollment","segment_reconcile"]'
) AS projections
WHERE outbox.`status` != 'processed';
