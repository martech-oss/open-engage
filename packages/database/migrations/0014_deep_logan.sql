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
	CONSTRAINT "project_items_resource_type_check" CHECK("__new_project_items"."resource_type" IN ('automation', 'email_sequence', 'segment', 'form', 'landing_page', 'redirect')),
	CONSTRAINT "project_items_brief_revision_check" CHECK("__new_project_items"."brief_revision" IS NULL OR "__new_project_items"."brief_revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_project_items`("workspace_id", "project_id", "resource_type", "resource_id", "brief_revision", "added_by_user_id", "created_at")
SELECT
	"workspace_id",
	"project_id",
	CASE "resource_type"
		WHEN 'email' THEN 'email_sequence'
		WHEN 'page' THEN 'landing_page'
		ELSE "resource_type"
	END,
	"resource_id",
	"brief_revision",
	"added_by_user_id",
	"created_at"
FROM `project_items`;--> statement-breakpoint
DROP TABLE `project_items`;--> statement-breakpoint
ALTER TABLE `__new_project_items` RENAME TO `project_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Rebuilding project_items drops its brief-link guards; recreate the three
-- triggers verbatim from migration 0008.
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
CREATE TABLE `__deal_pipeline_default_winners` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__deal_pipeline_default_winners` (`workspace_id`, `pipeline_id`)
SELECT `workspace_id`, `id`
FROM (
	SELECT
		`workspace_id`,
		`id`,
		ROW_NUMBER() OVER (
			PARTITION BY `workspace_id`
			ORDER BY `is_default` DESC, `created_at`, `id`
		) AS `winner_rank`
	FROM `deal_pipelines`
	WHERE `archived_at` IS NULL
)
WHERE `winner_rank` = 1;--> statement-breakpoint
UPDATE `deal_pipelines` SET `is_default` = 0;--> statement-breakpoint
UPDATE `deal_pipelines`
SET `is_default` = 1
WHERE EXISTS (
	SELECT 1
	FROM `__deal_pipeline_default_winners` `winner`
	WHERE `winner`.`workspace_id` = `deal_pipelines`.`workspace_id`
		AND `winner`.`pipeline_id` = `deal_pipelines`.`id`
);--> statement-breakpoint
DROP TABLE `__deal_pipeline_default_winners`;--> statement-breakpoint
CREATE UNIQUE INDEX `deal_pipelines_workspace_default_unique` ON `deal_pipelines` (`workspace_id`) WHERE "deal_pipelines"."is_default" = 1 AND "deal_pipelines"."archived_at" IS NULL;
