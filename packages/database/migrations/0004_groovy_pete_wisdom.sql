CREATE UNIQUE INDEX `projects_workspace_id_unique` ON `projects` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `project_brief_versions` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`approver_user_id` text NOT NULL,
	`primary_motion` text NOT NULL,
	`review_at` text NOT NULL,
	`definition` text NOT NULL,
	`approved_by_user_id` text NOT NULL,
	`approved_at` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `revision`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_brief_versions_revision_check" CHECK("project_brief_versions"."revision" >= 1),
	CONSTRAINT "project_brief_versions_definition_json_check" CHECK(json_valid("project_brief_versions"."definition"))
);
--> statement-breakpoint
CREATE INDEX `project_brief_versions_workspace_project_idx` ON `project_brief_versions` (`workspace_id`,`project_id`,`revision`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_briefs` (
	`project_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`owner_user_id` text NOT NULL,
	`approver_user_id` text NOT NULL,
	`primary_motion` text NOT NULL,
	`review_at` text NOT NULL,
	`definition` text NOT NULL,
	`submitted_at` text,
	`approved_at` text,
	`approved_by_user_id` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `projects`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_briefs_status_check" CHECK("__new_project_briefs"."status" IN ('draft', 'pending_approval', 'approved', 'completed')),
	CONSTRAINT "project_briefs_motion_check" CHECK("__new_project_briefs"."primary_motion" IN ('acquisition', 'onboarding', 'engagement', 'retention', 'reactivation', 'measurement')),
	CONSTRAINT "project_briefs_revision_check" CHECK("__new_project_briefs"."revision" >= 1),
	CONSTRAINT "project_briefs_row_version_check" CHECK("__new_project_briefs"."row_version" >= 1),
	CONSTRAINT "project_briefs_definition_json_check" CHECK(json_valid("__new_project_briefs"."definition")),
	CONSTRAINT "project_briefs_distinct_reviewers_check" CHECK("__new_project_briefs"."owner_user_id" != "__new_project_briefs"."approver_user_id")
);
--> statement-breakpoint
INSERT INTO `__new_project_briefs`("project_id", "workspace_id", "status", "revision", "row_version", "owner_user_id", "approver_user_id", "primary_motion", "review_at", "definition", "submitted_at", "approved_at", "approved_by_user_id", "completed_at", "created_at", "updated_at")
SELECT "project_id", "workspace_id", "status", "revision", 1, "owner_user_id", "approver_user_id", "primary_motion", "review_at", "definition", "submitted_at", "approved_at", "approved_by_user_id", "completed_at", "created_at", "updated_at" FROM `project_briefs`;--> statement-breakpoint
DROP TABLE `project_briefs`;--> statement-breakpoint
ALTER TABLE `__new_project_briefs` RENAME TO `project_briefs`;--> statement-breakpoint
CREATE INDEX `project_briefs_workspace_status_review_idx` ON `project_briefs` (`workspace_id`,`status`,`review_at`);--> statement-breakpoint
CREATE INDEX `project_briefs_workspace_owner_idx` ON `project_briefs` (`workspace_id`,`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_briefs_workspace_project_unique` ON `project_briefs` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `__new_project_brief_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`decision` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`,`project_id`) REFERENCES `project_briefs`(`workspace_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_brief_reviews_decision_check" CHECK("__new_project_brief_reviews"."decision" IN ('approved', 'rejected')),
	CONSTRAINT "project_brief_reviews_revision_check" CHECK("__new_project_brief_reviews"."revision" >= 1)
);--> statement-breakpoint
INSERT INTO `__new_project_brief_reviews`
SELECT `id`, `workspace_id`, `project_id`, `revision`, `reviewer_user_id`, `decision`, `comment`, `created_at`
FROM `project_brief_reviews`;--> statement-breakpoint
DROP TABLE `project_brief_reviews`;--> statement-breakpoint
ALTER TABLE `__new_project_brief_reviews` RENAME TO `project_brief_reviews`;--> statement-breakpoint
CREATE INDEX `project_brief_reviews_workspace_project_idx` ON `project_brief_reviews` (`workspace_id`,`project_id`,`created_at`);--> statement-breakpoint
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
	CONSTRAINT "project_items_resource_type_check" CHECK("__new_project_items"."resource_type" IN ('automation', 'email', 'form', 'page', 'segment')),
	CONSTRAINT "project_items_brief_revision_check" CHECK("__new_project_items"."brief_revision" IS NULL OR "__new_project_items"."brief_revision" >= 1)
);--> statement-breakpoint
INSERT INTO `__new_project_items`
SELECT `workspace_id`, `project_id`, `resource_type`, `resource_id`, `brief_revision`, `added_by_user_id`, `created_at`
FROM `project_items`;--> statement-breakpoint
DROP TABLE `project_items`;--> statement-breakpoint
ALTER TABLE `__new_project_items` RENAME TO `project_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
INSERT INTO `project_brief_versions` (
	`workspace_id`, `project_id`, `revision`, `name`, `description`, `color`,
	`owner_user_id`, `approver_user_id`, `primary_motion`, `review_at`, `definition`,
	`approved_by_user_id`, `approved_at`, `created_at`
)
SELECT
	b.`workspace_id`, b.`project_id`, b.`revision`, p.`name`, p.`description`, p.`color`,
	b.`owner_user_id`, b.`approver_user_id`, b.`primary_motion`, b.`review_at`, b.`definition`,
	COALESCE(b.`approved_by_user_id`, b.`approver_user_id`),
	COALESCE(b.`approved_at`, b.`updated_at`), b.`updated_at`
FROM `project_briefs` b
INNER JOIN `projects` p ON p.`workspace_id` = b.`workspace_id` AND p.`id` = b.`project_id`
WHERE b.`status` IN ('approved', 'completed');
--> statement-breakpoint
CREATE TRIGGER `project_briefs_compat_row_version`
AFTER UPDATE ON `project_briefs`
WHEN NEW.`row_version` = OLD.`row_version`
BEGIN
	UPDATE `project_briefs`
	SET `row_version` = OLD.`row_version` + 1
	WHERE `workspace_id` = NEW.`workspace_id`
		AND `project_id` = NEW.`project_id`
		AND `row_version` = OLD.`row_version`;
END;
--> statement-breakpoint
CREATE TRIGGER `project_briefs_row_version_guard`
BEFORE UPDATE ON `project_briefs`
WHEN NEW.`row_version` NOT IN (OLD.`row_version`, OLD.`row_version` + 1)
BEGIN
	SELECT RAISE(ABORT, 'project_briefs row_version must remain unchanged or advance by one');
END;
--> statement-breakpoint
CREATE TRIGGER `project_briefs_compat_approval_snapshot`
AFTER UPDATE ON `project_briefs`
WHEN NEW.`status` IN ('approved', 'completed')
	AND OLD.`status` NOT IN ('approved', 'completed')
BEGIN
	INSERT OR IGNORE INTO `project_brief_versions` (
		`workspace_id`, `project_id`, `revision`, `name`, `description`, `color`,
		`owner_user_id`, `approver_user_id`, `primary_motion`, `review_at`, `definition`,
		`approved_by_user_id`, `approved_at`, `created_at`
	)
	SELECT
		NEW.`workspace_id`, NEW.`project_id`, NEW.`revision`, p.`name`, p.`description`, p.`color`,
		NEW.`owner_user_id`, NEW.`approver_user_id`, NEW.`primary_motion`, NEW.`review_at`,
		NEW.`definition`, COALESCE(NEW.`approved_by_user_id`, NEW.`approver_user_id`),
		COALESCE(NEW.`approved_at`, NEW.`updated_at`), NEW.`updated_at`
	FROM `projects` p
	WHERE p.`workspace_id` = NEW.`workspace_id` AND p.`id` = NEW.`project_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `project_briefs_compat_reopen_snapshot`
AFTER UPDATE ON `project_briefs`
WHEN OLD.`status` IN ('approved', 'completed')
	AND NEW.`status` = 'draft'
	AND NEW.`revision` > OLD.`revision`
BEGIN
	INSERT OR IGNORE INTO `project_brief_versions` (
		`workspace_id`, `project_id`, `revision`, `name`, `description`, `color`,
		`owner_user_id`, `approver_user_id`, `primary_motion`, `review_at`, `definition`,
		`approved_by_user_id`, `approved_at`, `created_at`
	)
	SELECT
		OLD.`workspace_id`, OLD.`project_id`, OLD.`revision`, p.`name`, p.`description`, p.`color`,
		OLD.`owner_user_id`, OLD.`approver_user_id`, OLD.`primary_motion`, OLD.`review_at`,
		OLD.`definition`, COALESCE(OLD.`approved_by_user_id`, OLD.`approver_user_id`),
		COALESCE(OLD.`approved_at`, OLD.`updated_at`), OLD.`updated_at`
	FROM `projects` p
	WHERE p.`workspace_id` = OLD.`workspace_id` AND p.`id` = OLD.`project_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `projects_reject_locked_brief_metadata_update`
BEFORE UPDATE OF `name`, `description`, `color` ON `projects`
WHEN (NEW.`name` IS NOT OLD.`name`
		OR NEW.`description` IS NOT OLD.`description`
		OR NEW.`color` IS NOT OLD.`color`)
	AND EXISTS (
		SELECT 1 FROM `project_briefs` b
		WHERE b.`workspace_id` = OLD.`workspace_id`
			AND b.`project_id` = OLD.`id`
			AND b.`status` != 'draft'
	)
BEGIN
	SELECT RAISE(ABORT, 'locked project brief metadata cannot be changed');
END;
--> statement-breakpoint
CREATE TRIGGER `project_brief_reviews_validate_current_approval`
BEFORE INSERT ON `project_brief_reviews`
WHEN NOT EXISTS (
	SELECT 1
	FROM `project_briefs` b
	INNER JOIN `member` m
		ON m.`organization_id` = b.`workspace_id`
		AND m.`user_id` = NEW.`reviewer_user_id`
		AND m.`role` IN ('owner', 'admin', 'marketer')
	WHERE b.`workspace_id` = NEW.`workspace_id`
		AND b.`project_id` = NEW.`project_id`
		AND b.`revision` = NEW.`revision`
		AND b.`status` = 'pending_approval'
		AND b.`approver_user_id` = NEW.`reviewer_user_id`
)
BEGIN
	SELECT RAISE(ABORT, 'review no longer matches the pending brief revision');
END;
--> statement-breakpoint
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
