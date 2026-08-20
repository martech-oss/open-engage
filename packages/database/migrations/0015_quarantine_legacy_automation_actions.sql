-- Some in-flight jobs present when 0015 is applied may predate the action-effect
-- ledger and may already have committed their business effect. Their origin and
-- outcome cannot be proven from the job row, so deliberately quarantine every
-- existing leased/running job instead of allowing lease recovery to replay it.
UPDATE `automation_enrollments`
SET `status` = 'failed',
    `current_node_id` = NULL,
    `completed_at` = COALESCE(
      `completed_at`,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ),
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `status` = 'active'
  AND EXISTS (
    SELECT 1
    FROM `automation_jobs`
    WHERE `automation_jobs`.`workspace_id` = `automation_enrollments`.`workspace_id`
      AND `automation_jobs`.`enrollment_id` = `automation_enrollments`.`id`
      AND `automation_jobs`.`status` IN ('leased', 'running')
  );--> statement-breakpoint
UPDATE `automation_jobs`
SET `status` = 'failed',
    `lease_id` = NULL,
    `lease_until` = NULL,
    `wait_event_type` = NULL,
    `wait_resource_id` = NULL,
    `last_error` = 'legacy_outcome_unknown',
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `status` IN ('leased', 'running');
