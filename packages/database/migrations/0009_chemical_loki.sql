-- Disable legacy rules whose optional category/tag no longer belongs to the
-- rule workspace. Archived categories are invalid for new writes too, so they
-- are cleared by the same repair before composite ownership is enforced.
UPDATE `scoring_rules`
SET
	`enabled` = 0,
	`category_id` = CASE
		WHEN `category_id` IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM `scoring_categories` category
			WHERE category.`workspace_id` = `scoring_rules`.`workspace_id`
				AND category.`id` = `scoring_rules`.`category_id`
				AND category.`archived_at` IS NULL
		) THEN NULL
		ELSE `category_id`
	END,
	`tag_id` = CASE
		WHEN `tag_id` IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM `tags` tag
			WHERE tag.`workspace_id` = `scoring_rules`.`workspace_id`
				AND tag.`id` = `scoring_rules`.`tag_id`
		) THEN NULL
		ELSE `tag_id`
	END
WHERE
	(`category_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `scoring_categories` category
		WHERE category.`workspace_id` = `scoring_rules`.`workspace_id`
			AND category.`id` = `scoring_rules`.`category_id`
			AND category.`archived_at` IS NULL
	))
	OR (`tag_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `tags` tag
		WHERE tag.`workspace_id` = `scoring_rules`.`workspace_id`
			AND tag.`id` = `scoring_rules`.`tag_id`
	));--> statement-breakpoint
-- Cross-workspace junction rows are derived state and can be safely removed.
DELETE FROM `contact_tags`
WHERE NOT EXISTS (
		SELECT 1 FROM `contacts` contact
		WHERE contact.`workspace_id` = `contact_tags`.`workspace_id`
			AND contact.`id` = `contact_tags`.`contact_id`
	)
	OR NOT EXISTS (
		SELECT 1 FROM `tags` tag
		WHERE tag.`workspace_id` = `contact_tags`.`workspace_id`
			AND tag.`id` = `contact_tags`.`tag_id`
	);--> statement-breakpoint
DELETE FROM `contact_category_scores`
WHERE NOT EXISTS (
		SELECT 1 FROM `contacts` contact
		WHERE contact.`workspace_id` = `contact_category_scores`.`workspace_id`
			AND contact.`id` = `contact_category_scores`.`contact_id`
	)
	OR NOT EXISTS (
		SELECT 1 FROM `scoring_categories` category
		WHERE category.`workspace_id` = `contact_category_scores`.`workspace_id`
			AND category.`id` = `contact_category_scores`.`category_id`
	);--> statement-breakpoint
-- Invalid score rows are derived side effects; invalid audit events are kept
-- but detached from the foreign contact, matching contact deletion semantics.
DELETE FROM `score_events`
WHERE NOT EXISTS (
	SELECT 1 FROM `contacts` contact
	WHERE contact.`workspace_id` = `score_events`.`workspace_id`
		AND contact.`id` = `score_events`.`contact_id`
);--> statement-breakpoint
UPDATE `contact_events`
SET `contact_id` = NULL
WHERE `contact_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `contacts` contact
		WHERE contact.`workspace_id` = `contact_events`.`workspace_id`
			AND contact.`id` = `contact_events`.`contact_id`
	);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_workspace_id_unique` ON `contacts` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tags_workspace_id_unique` ON `tags` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_categories_workspace_id_unique` ON `scoring_categories` (`workspace_id`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contact_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text,
	`visitor_id` text,
	`type` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`properties` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_contact_events`("id", "workspace_id", "contact_id", "visitor_id", "type", "resource_type", "resource_id", "properties", "occurred_at", "archived_at", "created_at") SELECT "id", "workspace_id", "contact_id", "visitor_id", "type", "resource_type", "resource_id", "properties", "occurred_at", "archived_at", "created_at" FROM `contact_events`;--> statement-breakpoint
DROP TABLE `contact_events`;--> statement-breakpoint
ALTER TABLE `__new_contact_events` RENAME TO `contact_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `contact_events_workspace_visitor_idx` ON `contact_events` (`workspace_id`,`visitor_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `contact_events_workspace_type_occurred_idx` ON `contact_events` (`workspace_id`,`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `contact_events_workspace_contact_idx` ON `contact_events` (`workspace_id`,`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_contact_tags` (
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `contact_id`, `tag_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`tag_id`) REFERENCES `tags`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_contact_tags`("workspace_id", "contact_id", "tag_id", "created_at") SELECT "workspace_id", "contact_id", "tag_id", "created_at" FROM `contact_tags`;--> statement-breakpoint
DROP TABLE `contact_tags`;--> statement-breakpoint
ALTER TABLE `__new_contact_tags` RENAME TO `contact_tags`;--> statement-breakpoint
CREATE INDEX `contact_tags_workspace_tag_idx` ON `contact_tags` (`workspace_id`,`tag_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `__new_score_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`automation_enrollment_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_enrollment_id`) REFERENCES `automation_enrollments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_score_events`("id", "workspace_id", "contact_id", "delta", "reason", "automation_enrollment_id", "created_at") SELECT "id", "workspace_id", "contact_id", "delta", "reason", "automation_enrollment_id", "created_at" FROM `score_events`;--> statement-breakpoint
DROP TABLE `score_events`;--> statement-breakpoint
ALTER TABLE `__new_score_events` RENAME TO `score_events`;--> statement-breakpoint
CREATE INDEX `score_events_workspace_contact_idx` ON `score_events` (`workspace_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_contact_category_scores` (
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`category_id` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `contact_id`, `category_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `scoring_categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contacts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`category_id`) REFERENCES `scoring_categories`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_contact_category_scores`("workspace_id", "contact_id", "category_id", "score", "updated_at") SELECT "workspace_id", "contact_id", "category_id", "score", "updated_at" FROM `contact_category_scores`;--> statement-breakpoint
DROP TABLE `contact_category_scores`;--> statement-breakpoint
ALTER TABLE `__new_contact_category_scores` RENAME TO `contact_category_scores`;--> statement-breakpoint
CREATE INDEX `contact_category_scores_workspace_category_idx` ON `contact_category_scores` (`workspace_id`,`category_id`,`score`);--> statement-breakpoint
CREATE TABLE `__new_scoring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`event_type` text NOT NULL,
	`match_type` text DEFAULT 'any' NOT NULL,
	`match_value` text,
	`points` integer DEFAULT 0 NOT NULL,
	`category_id` text,
	`tag_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `scoring_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`category_id`) REFERENCES `scoring_categories`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`tag_id`) REFERENCES `tags`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scoring_rules_event_type_check" CHECK("__new_scoring_rules"."event_type" IN ('page_viewed', 'form_submitted', 'email_opened', 'email_clicked', 'email_replied', 'custom_redirect_clicked', 'custom_event')),
	CONSTRAINT "scoring_rules_match_type_check" CHECK("__new_scoring_rules"."match_type" IN ('any', 'resource', 'url_exact', 'url_contains', 'url_starts_with'))
);
--> statement-breakpoint
INSERT INTO `__new_scoring_rules`("id", "workspace_id", "name", "event_type", "match_type", "match_value", "points", "category_id", "tag_id", "enabled", "archived_at", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "event_type", "match_type", "match_value", "points", "category_id", "tag_id", "enabled", "archived_at", "created_at", "updated_at" FROM `scoring_rules`;--> statement-breakpoint
DROP TABLE `scoring_rules`;--> statement-breakpoint
ALTER TABLE `__new_scoring_rules` RENAME TO `scoring_rules`;--> statement-breakpoint
CREATE INDEX `scoring_rules_workspace_event_idx` ON `scoring_rules` (`workspace_id`,`event_type`,`enabled`);
