# Task 5 report: contract, default-pipeline, and project-resource invariants

## Status

Complete. Report inputs now retain the shared range refinements, every workspace with an active deal pipeline has one deterministic default, project briefs use one exhaustive six-type resource registry including redirects, and wrapped segment constraints use the shared classifier.

## Report contracts

- The deals and campaigns procedures use core `reportQuerySchema` directly; the duplicated local Zod object was removed.
- Contract tests cover both endpoints independently: reversed dates fail, an inclusive range longer than 366 days fails, and a valid range with lowercase currency parses and normalizes to `JPY`.

## Default deal-pipeline invariant

- `findDefaultPipeline` now filters active rows on `is_default = 1`. A raw zero-default state deterministically promotes the oldest active `(created_at, id)` candidate.
- Creating a pipeline repairs an existing zero-default workspace first and makes a new pipeline default only when required or explicitly requested. The first active custom pipeline is therefore always default.
- Promoting an active pipeline atomically clears the previous active default and promotes the target. The partial unique index is the database concurrency boundary; real-D1 parallel promotion tests finish with exactly one default.
- Directly sending `isDefault: false` for the current default returns `DEFAULT_DEAL_PIPELINE_REQUIRED` with status 409. The same input for a nondefault pipeline is a safe no-op. The client keeps the current default checked and disabled and explains that promoting another pipeline is the way to change it.
- Archiving executes its final-active, active-deal, archive, and deterministic fallback decisions at the database write boundary. Archiving the current default promotes the oldest remaining active `(created_at, id)` row atomically; the final active pipeline retains the precise last-pipeline outcome.

## Migration 0014 repair policy

- `0014_deep_logan.sql` was created through `pnpm db:generate`; migrations `0000` through `0013` were not edited.
- A temporary ranked winner table chooses one active pipeline per workspace by existing-default priority, then `(created_at, id)`. The migration clears every default flag, including archived rows, reapplies only the winners, drops the helper, and creates `deal_pipelines_workspace_default_unique` on `(workspace_id) WHERE is_default = 1 AND archived_at IS NULL`.
- The real SQLite migration test covers zero defaults, multiple defaults, archived defaults, deterministic ties, and a post-migration unique violation.
- `project_items` is rebuilt with the canonical six-type check. Legacy `email` links become `email_sequence`; legacy `page` links become `landing_page`.
- Rebuilding that table drops its triggers, so 0014 recreates all three brief-link guard triggers from 0008. The migration test verifies both renamed data and the complete trigger set.
- Final `pnpm db:generate` reports `No schema changes, nothing to migrate`, proving schema, snapshot, journal, and custom repair SQL are aligned.

## Project-resource registry

- Core exports the single tuple `PROJECT_RESOURCE_TYPES`: `automation`, `email_sequence`, `segment`, `form`, `landing_page`, and `redirect`. Zod, the database check, resolver batching, and the client selector reuse it where compatible.
- The focused resolver module declares an exhaustive registry with `satisfies Record<ProjectResourceType, ProjectResourceResolver>` and has no default/fallthrough branch that can silently reinterpret a new type.
- Every availability SQL predicate remains inside the conditional link write, preserving the archive-race guard. Reads and writes are workspace-scoped.
- Redirect resolution uses `custom_redirects`. An active redirect links and resolves as active with its name; an existing link remains visible with name and archived status after archive; archived, foreign-workspace, and missing redirects cannot be newly linked and resolve through the existing 404 domain outcome.
- The client selector exposes all six canonical types, including Redirect. Legacy project service/repository input types were tightened to `ProjectResourceType` without changing unrelated behavior.

## Constraint classification

- Segment create/update now use the shared `isConstraintError`, including its wrapped-cause traversal, instead of a local message regex.
- A real oRPC mutation test injects a wrapped SQLite constraint and verifies the typed `SEGMENT_CONFLICT` 409 response.
- The public-form contact-email classifier remains intentionally narrow and unchanged.

## Strict TDD evidence

### RED

- Report contract test: both deals and campaigns accepted reversed date ranges under the duplicated local schema.
- Core project type test: the canonical tuple did not exist and `email_sequence` was rejected.
- Redirect integration test: an active workspace redirect returned `resource_not_found`; the client selector omitted Redirect and exposed legacy values.
- Deal UI test: the current default checkbox remained enabled and had no explanatory copy.
- Real-D1 deal tests: direct default demotion resolved successfully, and the first custom pipeline could be persisted as nondefault. The added zero-default, concurrent-promotion, fallback, and final-active cases then drove the invariant implementation.
- Real SQLite migration test: pre-repair duplicate defaults violated the new index, and canonical project types violated the legacy check. A self-review RED also proved that the table rebuild had dropped all three brief-link triggers before their explicit recreation.
- Wrapped segment constraint test: the route returned 500 instead of the typed 409.
- Existing deal regression coverage exposed the final-active archive check being shadowed by the in-use result; outcome ordering was corrected before GREEN.

### GREEN

- Focused deal suite: 1 file, 7/7 tests passed.
- Focused project-brief suite: 1 file, 8/8 tests passed, including active detail, archived retention, and archived/foreign/missing rejection.
- Focused migration suite: 1 file, 2/2 tests passed.
- Affected server suites: 4 files, 35/35 tests passed.
- Core: 13 files, 98/98 tests passed.
- oRPC: 1 file, 7/7 tests passed.
- Database: 6 files, 12/12 tests passed.
- Client: 25 files, 92/92 tests passed.
- Server: 53 files, 291/291 tests passed.

## Final verification

- All eight workspace typechecks passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm architecture:check`: 653 source files; no forbidden dependency, cycle, or file-size ratchet failure.
- `node scripts/check-no-raw-sql.mjs` in `apps/server`: clean.
- `pnpm db:generate`: 71 tables; `No schema changes, nothing to migrate`.
- Client production build and TypeScript check: passed.
- Server Wrangler dry-run build: passed.
- `git diff --check`: passed.

## Files changed

- Reports and errors: `packages/orpc/src/reports/contract.ts`, `packages/orpc/src/deals/contract.ts`, `packages/orpc/src/index.test.ts`, and the deal server router/service.
- Deal persistence and UI: `packages/database/src/deals/repository.ts`, `packages/database/src/deals/schema.ts`, `apps/server/test/deals.test.ts`, `apps/client/src/features/deals/deal-pipeline-form.tsx`, and its DOM test.
- Project resource model and resolution: core project DTO/tests, database web schema/repositories, `packages/database/src/web/project-resource-resolvers.ts`, the email-sequence project link, server project service/tests, and the client project-resource dialog/DOM test.
- Constraint handling: `apps/server/src/segments/router.ts` and `apps/server/test/orpc-mutations.test.ts`.
- Migration: `packages/database/migrations/0014_deep_logan.sql`, `0014_snapshot.json`, `_journal.json`, and the focused migration test.

## Self-review and residuals

- The new resolver is focused and exhaustive; extracting it reduced the link repository rather than growing another large conditional file.
- `packages/database/src/deals/repository.ts` remains an existing large-file-ratchet exception. Task 5 added only the focused invariant behavior; the broad Task 8 split was intentionally not entered.
- Database uniqueness and transactional batches are the final authority for promotion/archive races; tests use real D1/SQLite behavior rather than helper mocks.
- No known Task 5 behavioral residual remains. No Task 6+ or unrelated Task 8 work was performed.
