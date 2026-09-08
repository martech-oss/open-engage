CREATE TABLE `automation_run_targets` (
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`enrollment_id` text,
	`reason` text,
	`last_error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `contact_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_run_targets_status_check" CHECK("automation_run_targets"."status" IN ('pending','enrolled','skipped','failed'))
);
--> statement-breakpoint
CREATE INDEX `automation_run_targets_pending_idx` ON `automation_run_targets` (`workspace_id`,`run_id`,`status`,`contact_id`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`automation_version_id` text NOT NULL,
	`slot` text NOT NULL,
	`status` text DEFAULT 'enrolling' NOT NULL,
	`created_at` text NOT NULL,
	`enrollment_completed_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL,
	`last_error` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_version_id`) REFERENCES `automation_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_runs_status_check" CHECK("automation_runs"."status" IN ('enrolling','running','completed','cancelled','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_slot_unique` ON `automation_runs` (`workspace_id`,`automation_id`,`slot`);--> statement-breakpoint
CREATE INDEX `automation_runs_recovery_idx` ON `automation_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `project_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_variables_type_check" CHECK("project_variables"."type" IN ('string','number','boolean','datetime','url')),
	CONSTRAINT "project_variables_revision_check" CHECK("project_variables"."revision">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_variables_workspace_key_unique` ON `project_variables` (`workspace_id`,`key`) WHERE "project_variables"."project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `project_variables_project_key_unique` ON `project_variables` (`workspace_id`,`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `project_member_commands` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `idempotency_key`),
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_member_commands_result_json" CHECK(json_valid("project_member_commands"."result"))
);
--> statement-breakpoint
CREATE TABLE `project_member_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`member_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`definition_version` integer NOT NULL,
	`revision` integer NOT NULL,
	`previous_status_id` text,
	`status_id` text NOT NULL,
	`status_label` text NOT NULL,
	`success` integer NOT NULL,
	`first_success_at` text,
	`source` text NOT NULL,
	`mode` text NOT NULL,
	`reason` text,
	`actor_user_id` text,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`member_id`) REFERENCES `project_members`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_member_transitions_correction_reason" CHECK("project_member_transitions"."mode" = 'progress' OR ("project_member_transitions"."mode"='correction' AND "project_member_transitions"."source"='manual' AND length(trim("project_member_transitions"."reason"))>0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_member_transitions_revision_unique` ON `project_member_transitions` (`workspace_id`,`member_id`,`revision`);--> statement-breakpoint
CREATE INDEX `project_member_transitions_asof_idx` ON `project_member_transitions` (`workspace_id`,`project_id`,`member_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`definition_version` integer NOT NULL,
	`status_id` text NOT NULL,
	`status_label` text NOT NULL,
	`joined_at` text NOT NULL,
	`first_success_at` text,
	`source` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`project_id`,`definition_version`) REFERENCES `project_program_versions`(`workspace_id`,`project_id`,`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_members_revision" CHECK("project_members"."revision">0),
	CONSTRAINT "project_members_success_time" CHECK("project_members"."first_success_at" IS NULL OR "project_members"."first_success_at" >= "project_members"."joined_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_workspace_project_contact_unique` ON `project_members` (`workspace_id`,`project_id`,`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_workspace_id_unique` ON `project_members` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `project_members_cohort_idx` ON `project_members` (`workspace_id`,`project_id`,`joined_at`);--> statement-breakpoint
CREATE INDEX `project_members_contact_idx` ON `project_members` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `project_program_versions` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text,
	PRIMARY KEY(`workspace_id`, `project_id`, `version`),
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_program_versions_definition_json" CHECK(json_valid("project_program_versions"."definition")),
	CONSTRAINT "project_program_versions_positive" CHECK("project_program_versions"."version">0)
);
--> statement-breakpoint
CREATE TABLE `project_programs` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`definition` text NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`published_version` integer,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`),
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_programs_definition_json" CHECK(json_valid("project_programs"."definition")),
	CONSTRAINT "project_programs_revision" CHECK("project_programs"."row_version">0)
);
--> statement-breakpoint
CREATE TABLE `form_program_bindings` (
	`workspace_id` text NOT NULL,
	`form_id` text NOT NULL,
	`project_id` text NOT NULL,
	`definition_version` integer,
	`status_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `form_id`),
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`project_id`,`definition_version`) REFERENCES `project_program_versions`(`workspace_id`,`project_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_clone_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_project_id` text NOT NULL,
	`target_project_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`request_key` text,
	`options` text NOT NULL,
	`shared_references` text DEFAULT '[]' NOT NULL,
	`reference_map` text NOT NULL,
	`status` text DEFAULT 'preview' NOT NULL,
	`error` text,
	`lease_id` text,
	`lease_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_clone_jobs_status_check" CHECK("project_clone_jobs"."status" IN ('preview','queued','running','completed','failed')),
	CONSTRAINT "project_clone_jobs_json_check" CHECK(json_valid("project_clone_jobs"."options") AND json_valid("project_clone_jobs"."shared_references") AND json_valid("project_clone_jobs"."reference_map"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_clone_jobs_request_unique` ON `project_clone_jobs` (`workspace_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_clone_jobs_target_unique` ON `project_clone_jobs` (`target_project_id`);--> statement-breakpoint
CREATE INDEX `project_clone_jobs_recovery_idx` ON `project_clone_jobs` (`status`,`lease_until`,`updated_at`);--> statement-breakpoint
CREATE INDEX `project_clone_jobs_workspace_project_idx` ON `project_clone_jobs` (`workspace_id`,`source_project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_clone_mappings` (
	`job_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`metadata` text NOT NULL,
	`source_row` text NOT NULL,
	`target_row` text,
	PRIMARY KEY(`job_id`, `kind`, `source_id`),
	FOREIGN KEY (`job_id`) REFERENCES `project_clone_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_clone_mappings_json_check" CHECK(json_valid("project_clone_mappings"."metadata") AND json_valid("project_clone_mappings"."source_row") AND ("project_clone_mappings"."target_row" IS NULL OR json_valid("project_clone_mappings"."target_row")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_clone_mappings_order_unique` ON `project_clone_mappings` (`job_id`,`ordinal`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automation_triggers` (
	`automation_version_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`source` text NOT NULL,
	`event_type` text,
	`resource_id` text,
	`reentry` text DEFAULT 'once' NOT NULL,
	`inactivity_days` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`automation_version_id`) REFERENCES `automation_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_triggers_source_check" CHECK("__new_automation_triggers"."source" IN ('segment_joined', 'form_submitted', 'contact_created', 'api_event', 'webhook_event', 'contact_inactive', 'batch', 'callable', 'project_member_joined', 'project_member_progressed', 'project_member_succeeded')),
	CONSTRAINT "automation_triggers_reentry_check" CHECK("__new_automation_triggers"."reentry" IN ('once', 'every_time', 'cooldown'))
);
--> statement-breakpoint
INSERT INTO `__new_automation_triggers`("automation_version_id", "workspace_id", "automation_id", "source_node_id", "source", "event_type", "resource_id", "reentry", "inactivity_days", "created_at") SELECT "automation_version_id", "workspace_id", "automation_id", "source_node_id", "source", "event_type", "resource_id", "reentry", "inactivity_days", "created_at" FROM `automation_triggers`;--> statement-breakpoint
DROP TABLE `automation_triggers`;--> statement-breakpoint
ALTER TABLE `__new_automation_triggers` RENAME TO `automation_triggers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `automation_triggers_workspace_event_idx` ON `automation_triggers` (`workspace_id`,`event_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `automation_triggers_source_idx` ON `automation_triggers` (`source`,`workspace_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `acquisition_project_id` text;--> statement-breakpoint
ALTER TABLE `automation_enrollments` ADD `parent_job_id` text;--> statement-breakpoint
ALTER TABLE `automation_enrollments` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `automation_enrollments` ADD `execution_snapshot` text;--> statement-breakpoint
CREATE UNIQUE INDEX `automation_enrollments_parent_job_unique` ON `automation_enrollments` (`workspace_id`,`parent_job_id`);--> statement-breakpoint
CREATE INDEX `automation_enrollments_reentry_idx` ON `automation_enrollments` (`workspace_id`,`automation_id`,`contact_id`,`entered_at`);--> statement-breakpoint
ALTER TABLE `automation_versions` ADD `resolved_graph` text;--> statement-breakpoint
ALTER TABLE `automation_versions` ADD `dependencies` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_versions` ADD `variable_snapshot` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `variable_project_id` text;--> statement-breakpoint
CREATE TABLE `__new_custom_redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`destination_url` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "custom_redirects_status_check" CHECK("__new_custom_redirects"."status" IN ('draft','published'))
);
--> statement-breakpoint
INSERT INTO `__new_custom_redirects`("id", "workspace_id", "name", "slug", "destination_url", "status", "click_count", "archived_at", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "slug", "destination_url", 'published', "click_count", "archived_at", "created_at", "updated_at" FROM `custom_redirects`;--> statement-breakpoint
DROP TABLE `custom_redirects`;--> statement-breakpoint
ALTER TABLE `__new_custom_redirects` RENAME TO `custom_redirects`;--> statement-breakpoint
CREATE INDEX `custom_redirects_workspace_updated_idx` ON `custom_redirects` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_redirects_workspace_slug_unique` ON `custom_redirects` (`workspace_id`,`slug`);--> statement-breakpoint
ALTER TABLE `form_versions` ADD `source_definition` text;--> statement-breakpoint
ALTER TABLE `form_versions` ADD `source_success_message` text;--> statement-breakpoint
ALTER TABLE `form_versions` ADD `variable_project_id` text;--> statement-breakpoint
ALTER TABLE `form_versions` ADD `variable_snapshot` text;--> statement-breakpoint
ALTER TABLE `form_versions` ADD `program_binding` text;--> statement-breakpoint
ALTER TABLE `form_versions` ADD `published_at` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `source_definition` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `source_success_message` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `variable_project_id` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `variable_snapshot` text;--> statement-breakpoint
ALTER TABLE `landing_page_versions` ADD `published_document` text;--> statement-breakpoint
ALTER TABLE `landing_page_versions` ADD `variable_snapshot` text;
