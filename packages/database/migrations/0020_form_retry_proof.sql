ALTER TABLE `form_submissions` ADD `request_fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `identity_proof_hash` text;