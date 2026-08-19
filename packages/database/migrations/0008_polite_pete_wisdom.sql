CREATE TABLE `campaign_touches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_touches_workspace_contact_idx` ON `campaign_touches` (`workspace_id`,`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `campaign_touches_workspace_project_idx` ON `campaign_touches` (`workspace_id`,`project_id`,`occurred_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_items` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`brief_revision` integer,
	`added_by_user_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `resource_type`, `resource_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_items_resource_type_check" CHECK("__new_project_items"."resource_type" IN ('automation', 'email', 'form', 'page', 'redirect', 'segment')),
	CONSTRAINT "project_items_brief_revision_check" CHECK("__new_project_items"."brief_revision" IS NULL OR "__new_project_items"."brief_revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_project_items`("workspace_id", "project_id", "resource_type", "resource_id", "brief_revision", "added_by_user_id", "created_at") SELECT "workspace_id", "project_id", "resource_type", "resource_id", "brief_revision", "added_by_user_id", "created_at" FROM `project_items`;--> statement-breakpoint
DROP TABLE `project_items`;--> statement-breakpoint
ALTER TABLE `__new_project_items` RENAME TO `project_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- Rebuilding project_items above dropped the triggers attached to it, so the
-- brief-link guards are recreated verbatim from migration 0004.
CREATE TRIGGER `project_items_validate_brief_link`
BEFORE INSERT ON `project_items`
WHEN EXISTS (
		SELECT 1 FROM `project_briefs` b
		WHERE b.`workspace_id` = NEW.`workspace_id` AND b.`project_id` = NEW.`project_id`
	)
	AND NOT EXISTS (
		SELECT 1
		FROM `project_briefs` b
		INNER JOIN `projects` p
			ON p.`workspace_id` = b.`workspace_id` AND p.`id` = b.`project_id`
		INNER JOIN `organization` o ON o.`id` = b.`workspace_id`
		WHERE b.`workspace_id` = NEW.`workspace_id`
			AND b.`project_id` = NEW.`project_id`
			AND b.`status` = 'approved'
			AND b.`revision` = NEW.`brief_revision`
			AND p.`archived_at` IS NULL
			AND (
				(
					b.`owner_user_id` = NEW.`added_by_user_id`
					AND EXISTS (
						SELECT 1 FROM `member` owner_member
						WHERE owner_member.`organization_id` = NEW.`workspace_id`
							AND owner_member.`user_id` = NEW.`added_by_user_id`
							AND owner_member.`role` IN ('owner', 'admin', 'marketer')
					)
				)
				OR EXISTS (
					SELECT 1 FROM `member` admin_member
					WHERE admin_member.`organization_id` = NEW.`workspace_id`
						AND admin_member.`user_id` = NEW.`added_by_user_id`
						AND admin_member.`role` IN ('owner', 'admin')
				)
			)
	)
BEGIN
	SELECT RAISE(ABORT, 'brief resource link no longer matches an approved revision');
END;
--> statement-breakpoint
CREATE TRIGGER `project_items_validate_brief_relink`
BEFORE UPDATE OF `brief_revision`, `added_by_user_id`, `created_at` ON `project_items`
WHEN EXISTS (
		SELECT 1 FROM `project_briefs` b
		WHERE b.`workspace_id` = NEW.`workspace_id` AND b.`project_id` = NEW.`project_id`
	)
	AND NOT (
		NEW.`added_by_user_id` IS NULL
		AND OLD.`added_by_user_id` IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM `user` u WHERE u.`id` = OLD.`added_by_user_id`)
	)
	AND NOT EXISTS (
		SELECT 1
		FROM `project_briefs` b
		INNER JOIN `projects` p
			ON p.`workspace_id` = b.`workspace_id` AND p.`id` = b.`project_id`
		WHERE b.`workspace_id` = NEW.`workspace_id`
			AND b.`project_id` = NEW.`project_id`
			AND b.`status` = 'approved'
			AND b.`revision` = NEW.`brief_revision`
			AND p.`archived_at` IS NULL
			AND (
				(
					b.`owner_user_id` = NEW.`added_by_user_id`
					AND EXISTS (
						SELECT 1 FROM `member` owner_member
						WHERE owner_member.`organization_id` = NEW.`workspace_id`
							AND owner_member.`user_id` = NEW.`added_by_user_id`
							AND owner_member.`role` IN ('owner', 'admin', 'marketer')
					)
				)
				OR EXISTS (
					SELECT 1 FROM `member` admin_member
					WHERE admin_member.`organization_id` = NEW.`workspace_id`
						AND admin_member.`user_id` = NEW.`added_by_user_id`
						AND admin_member.`role` IN ('owner', 'admin')
				)
			)
	)
BEGIN
	SELECT RAISE(ABORT, 'brief resource relink no longer matches an approved revision');
END;
--> statement-breakpoint
CREATE TRIGGER `project_items_reject_locked_brief_delete`
BEFORE DELETE ON `project_items`
WHEN EXISTS (
		SELECT 1
		FROM `project_briefs` b
		INNER JOIN `projects` p
			ON p.`workspace_id` = b.`workspace_id` AND p.`id` = b.`project_id`
		INNER JOIN `organization` o ON o.`id` = b.`workspace_id`
		WHERE b.`workspace_id` = OLD.`workspace_id`
			AND b.`project_id` = OLD.`project_id`
			AND (b.`status` != 'approved' OR p.`archived_at` IS NOT NULL)
	)
BEGIN
	SELECT RAISE(ABORT, 'brief resource links are locked outside an approved revision');
END;
