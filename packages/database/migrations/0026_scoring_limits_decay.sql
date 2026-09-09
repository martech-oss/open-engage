ALTER TABLE scoring_rules ADD COLUMN decay_days integer;
--> statement-breakpoint
ALTER TABLE scoring_rules ADD COLUMN max_score integer;
--> statement-breakpoint
CREATE TABLE score_contributions (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id text NOT NULL,
  rule_id text NOT NULL,
  category_id text,
  initial_score integer NOT NULL,
  remaining_score integer NOT NULL,
  decay_days integer,
  occurred_at text NOT NULL,
  next_decay_at text,
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts(workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX score_contributions_contact_rule_idx ON score_contributions(workspace_id, contact_id, rule_id);
--> statement-breakpoint
CREATE INDEX score_contributions_due_idx ON score_contributions(next_decay_at);
