# Pardot gap implementation

The approved specification is the four-phase plan in the Codex conversation dated 2026-09-08. This file is the implementation and recovery map.

Implementation completed on 2026-09-08. Final `pnpm check` passed all 27 tasks (server 499 tests, client 308, core 145, database 22, oRPC 16, agent 58, SDK 4; scaffold checks reused successful cache). The public/API journey covers anonymous LP view → form → scoring/segment → sales handoff → deal won → campaign ROI and lifecycle reports. Independent bounded reviews passed after corrections. Migrations and development seed are provided; existing databases were not modified. Real external AI-provider smoke tests and a manual browser walkthrough remain environment checks.

## Global Constraints

- Implement all four phases end to end: database, contracts, server, UI, and behavioral tests.
- Exclude bulk marketing email and derivatives, SaaS login additions, and external CRM connectors.
- Development schema/API breaking changes are allowed. Generate Drizzle migrations; do not implement data migration/backfill for legacy development databases. Do not reset any existing database without an explicit request.
- Keep the existing 15 domain boundaries. Core owns pure schemas/logic; database repositories own SQL; server commands own atomic multi-resource work; oRPC exposes REST/SDK/MCP; UI accesses oRPC only through feature API modules.
- Retain workspace authorization, immutable published versions, durable job retry, idempotency, and existing transactional messaging behavior.
- Current checkout is the user's dedicated `gap-pardot` branch. Work here and preserve others' edits. No push, deploy, or external publication.

## Task 1: Visitor identity and event continuity

Independent workspace-scoped visitors support many browsers per contact. Sign visitor tokens with TRACKING_SIGNING_SECRET; token is correlation, never authentication or a source of personal-data disclosure. Tracking/form/redirect/progressive/site-message paths use the same resolver. Public raw email identification is replaced by short-lived assertions issued through authenticated API. Contact + visitor binding + submission + events are committed atomically. No consent means forms still work but no visitor history binding. A different submitted email rotates identity instead of reassigning old history. Persisted token supports return visits without email.

Recover unbound visitor events in bounded durable jobs, attach only anonymous events, apply scoring/grade/campaign projections once, skip historical automation/decision side effects, reconcile current segments on completion. Restart safely after partial processing. Event context carries validated page/version/form/project and source data. Preserve event IDs for deduplication.

Acceptance: anonymous page views -> form -> reload/revisit -> redirect belong to one contact; multiple browsers, different-email rotation, denied consent, forgery/cross-workspace tokens, concurrent and retried submission, interrupted/retried backfill do not misidentify or duplicate effects.

## Task 2: Rich segments and sales handoff

Extend segment predicates for category score, event type/resource/time/count/properties, company custom fields, and deal status/stage/owner/value. Conditions within a company/deal group must match the same related row. Share typed AST, SQL, validation, preview, UI and AI catalog. Relevant contact/score/company/deal mutations reconcile membership; time-only expiry reflects within five minutes under normal load using scheduled durable reevaluation.

Add contacts.ownerUserId and independent lifecycleStage (lead/mql/sql/customer), retaining the existing free-text stage. Unify tasks so contactId or dealId is required, both must agree, and all references are workspace scoped. Contact detail, deal detail and My Tasks operate on the same resource. Add fixed-user or round-robin assignment groups. Eligible users are workspace members able to manage marketing; preserve valid existing owner by default. Empty/ineligible groups fail without partial effects.

Expose one handoff-to-sales command and automation action: atomically choose/assign owner, record first MQL arrival, create task, create app notification. Reuse execution key on retries; explicit automation reentry may create a new handoff for a new enrollment. Add manual handoff UI and task/notification/group management UI.

Lifecycle is monotonic highest attained: lead on creation, mql on handoff success, sql on deal create/link, customer on won deal. Persist actual first arrival timestamps and transition history. No automatic loss regression, no fabricated skipped-stage timestamps, no universal MQL score threshold. Ensure all producers (forms/import/API/deals) participate; use contact creation timestamps as lead truth if no explicit row.

Acceptance: category threshold + recent form + no open deal selects correctly and creates owner/task/notification once. Cover same-related-row predicates, time expiry, concurrent round robin, no owner, task link validation, retries and skipped lifecycle stages.

Ownership: Task 2 owns contacts sales/lifecycle additions, deals/tasks, segments, sales automation action, relevant UI and tests. Task 1 owns visitor schema/repository/events/public forms and will integrate contact schema edits. Coordinate shared files; do not generate migrations until the controller requests it.

## Task 3: Forms and AI landing pages

Form handlers support JSON and application/x-www-form-urlencoded, external-to-contact field mapping, allowed domains, configured success/failure redirects. Reuse hosted submission validation/Turnstile/idempotency/contact-event pipeline. Add visibleWhen/requiredWhen dependencies, reject cycles, ignore hidden fields, and share server/browser progressive behavior.

Replace LP block editor with prompt/chat + desktop/mobile preview + revisions + publication. Dedicated Flue LandingPageDesigner emits typed HTML/CSS, managed form/CTA/image slots, metadata and measurement configuration. Reuse brand profile and image generation; generate drafts, never auto-publish or invent factual claims. Durable asynchronous generation status survives navigation, stale revisions cannot overwrite newer work, failure preserves last valid draft. Agent route/DO export/migration are required.

Use rehype parse/sanitize/stringify and css-tree validation. No arbitrary generated JS/external scripts; trusted form/tracking runtime only. Sandboxed preview generates no real events/actions. Version pages and forms, pin form version in page publication, clone shared forms for AI edits. Prepare assets then atomically publish page/form/measurement references; preserve rollback. Track actual page views, CTA clicks, successful form submissions with validated context and identity from Task 1.

Acceptance: prompt -> draft with managed form -> chat edit -> publish -> identified submission -> handoff. Cover JSON/browser handlers, mappings, dependent/progressive fields, duplicate submissions/Turnstile, bad HTML/CSS/references, async errors/stale versions, atomic publication/rollback, responsive accessible preview.

## Task 4: Experiments, personalization, ROI and lifecycle reporting

Experiments have 2-5 page variants, integer traffic weights summing to 100, default two at 50/50. Pin published versions at start; edits require new experiment; stable visitor assignment; manual end/winner. Count actual exposure and successful primary-form conversion once per visitor/experiment, within 30 days of first exposure. Report exposure-date cohorts and incomplete windows. No consent gets control without visitor-level experiment recording.

Dynamic slots have ordered segment rules and fallback; first match wins, anonymous/non-consenting visitors get fallback. Prevent personalized cache leakage. Integrate with LP renderer and editing UI.

Project campaign costs have accounting date, category, amount, currency. ROI defaults last touch, supports first touch; influenced revenue separate. Within selected period use cost accounting date and deal won date, ROI=(attributed revenue-cost)/cost*100, null for zero cost. Never sum currencies or auto-convert. Add UI/API for costs and campaign metrics.

Lifecycle report cohorts by contact creation, first stage arrivals/rates/median stage-to-stage duration, distinguish skipped stages, filter project/owner, use workspace timezone. Use Task 2 history, no invented times. E2E complete anonymous LP -> conversion -> MQL -> deal -> won -> reports.

## Verification

Write meaningful failing tests before behavior changes, run applicable suites per task and pnpm check after integration. Tests should assert real externally visible effects. Track job failures/delay in existing logging. Maintain a recovery ledger as work proceeds. Commit/push/deploy are not required for this request.
