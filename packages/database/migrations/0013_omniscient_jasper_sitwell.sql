CREATE TABLE `contact_import_parts` (
	`job_id` text NOT NULL,
	`part` integer NOT NULL,
	`total_parts` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_id` text,
	`lease_expires_at` text,
	`candidates` text,
	`reconciliation_contact_ids` text,
	`reconciliation_published_at` text,
	`processed` integer DEFAULT 0 NOT NULL,
	`succeeded` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`job_id`, `part`),
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_import_parts_status_check" CHECK("contact_import_parts"."status" IN ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "contact_import_parts_part_check" CHECK("contact_import_parts"."part" >= 0),
	CONSTRAINT "contact_import_parts_total_check" CHECK("contact_import_parts"."total_parts" > "contact_import_parts"."part"),
	CONSTRAINT "contact_import_parts_attempts_check" CHECK("contact_import_parts"."attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX `contact_import_parts_pending_idx` ON `contact_import_parts` (`updated_at`,`job_id`,`part`) WHERE "contact_import_parts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `contact_import_parts_processing_lease_idx` ON `contact_import_parts` (`lease_expires_at`,`job_id`,`part`) WHERE "contact_import_parts"."status" = 'processing';--> statement-breakpoint
CREATE INDEX `contact_import_parts_reconciliation_pending_idx` ON `contact_import_parts` (`updated_at`,`job_id`,`part`) WHERE "contact_import_parts"."status" = 'completed' AND "contact_import_parts"."reconciliation_contact_ids" IS NOT NULL AND "contact_import_parts"."reconciliation_published_at" IS NULL;--> statement-breakpoint
INSERT INTO `contact_import_parts`
  (`job_id`, `part`, `total_parts`, `status`, `attempts`, `created_at`, `updated_at`)
SELECT
  `id`,
  COALESCE(CAST(json_extract(`cursor`, '$.part') AS INTEGER), 0),
  CAST(json_extract(`cursor`, '$.totalParts') AS INTEGER),
  'pending',
  0,
  `created_at`,
  `updated_at`
FROM `import_jobs`
WHERE `kind` = 'contact_import'
  AND `status` = 'pending'
  AND json_valid(`cursor`)
  AND CAST(json_extract(`cursor`, '$.totalParts') AS INTEGER)
      > COALESCE(CAST(json_extract(`cursor`, '$.part') AS INTEGER), 0);--> statement-breakpoint
INSERT INTO `contact_import_parts`
  (`job_id`, `part`, `total_parts`, `status`, `attempts`, `last_error`, `created_at`, `updated_at`)
SELECT
  `id`,
  COALESCE(CAST(json_extract(`cursor`, '$.part') AS INTEGER), 0),
  CAST(json_extract(`cursor`, '$.totalParts') AS INTEGER),
  'failed',
  0,
  'legacy_outcome_unknown',
  `created_at`,
  `updated_at`
FROM `import_jobs`
WHERE `kind` = 'contact_import'
  AND `status` = 'processing'
  AND json_valid(`cursor`)
  AND CAST(json_extract(`cursor`, '$.totalParts') AS INTEGER)
      > COALESCE(CAST(json_extract(`cursor`, '$.part') AS INTEGER), 0);--> statement-breakpoint
UPDATE `import_jobs`
SET `status` = 'failed'
WHERE `kind` = 'contact_import'
  AND `status` = 'processing'
  AND EXISTS (
    SELECT 1 FROM `contact_import_parts`
    WHERE `contact_import_parts`.`job_id` = `import_jobs`.`id`
      AND `contact_import_parts`.`status` = 'failed'
      AND `contact_import_parts`.`last_error` = 'legacy_outcome_unknown'
  );--> statement-breakpoint
ALTER TABLE `deliveries` ADD `lease_id` text;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `lease_expires_at` text;--> statement-breakpoint
UPDATE `deliveries`
SET `status` = 'failed', `last_error` = 'outcome_unknown',
    `next_attempt_at` = NULL, `lease_id` = NULL, `lease_expires_at` = NULL
WHERE `status` = 'sending' AND `channel` = 'email';--> statement-breakpoint
UPDATE `deliveries`
SET `status` = 'queued', `last_error` = 'legacy_sending_recovered',
    `next_attempt_at` = NULL, `lease_id` = NULL, `lease_expires_at` = NULL
WHERE `status` = 'sending' AND `channel` = 'webhook' AND `attempts` < 5;--> statement-breakpoint
UPDATE `deliveries`
SET `status` = 'failed', `last_error` = 'attempts_exhausted',
    `next_attempt_at` = NULL, `lease_id` = NULL, `lease_expires_at` = NULL
WHERE `status` = 'sending' AND `channel` = 'webhook' AND `attempts` >= 5;--> statement-breakpoint
UPDATE `deliveries`
SET `status` = 'failed', `last_error` = 'attempts_exhausted',
    `next_attempt_at` = NULL, `lease_id` = NULL, `lease_expires_at` = NULL
WHERE `status` = 'queued' AND `attempts` >= 5;--> statement-breakpoint
CREATE INDEX `deliveries_queued_due_idx` ON `deliveries` (`next_attempt_at`,`created_at`) WHERE "deliveries"."status" = 'queued' AND "deliveries"."attempts" < 5;--> statement-breakpoint
CREATE INDEX `deliveries_sending_lease_idx` ON `deliveries` (`lease_expires_at`,`created_at`) WHERE "deliveries"."status" = 'sending';
