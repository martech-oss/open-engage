# Task 6B report: scoring and contact drawer decomposition

## Outcome

- Decomposed both scoring pages into composition-only route views backed by dedicated page controllers.
- Extracted scoring summaries into a pure model, DataTable column factories into a focused column module, and rule/criterion/category forms into focused editor views with editor controllers.
- Decomposed the contact drawer into an on-demand query/controller, overview, keyed profile form, relations, score form, and timeline tab.
- Kept the contact profile query lazy: `ContactDrawer` is still rendered only for an active contact and `useQuery` lives in the mounted drawer controller rather than a route loader or suspense prefetch.
- Keyed the drawer body and the uncontrolled profile draft by contact ID. Controller UI state also derives a fresh details tab/error/busy state when its entity ID changes, without a prop-reset effect.
- Preserved `WorkspaceTimeProvider` usage by retaining the bound `useWorkspaceFormatters().formatLongDateTime` formatter in the extracted timeline tab.
- Did not touch the Task 3 atomic contact-create command/cache invalidation boundary or the Task 4 contact export controller.

## Production structure

### Scoring

- `scoring-rules-controller.ts` owns rules/categories queries, resource editor dialog state, archive mutation outcome, and summary composition.
- `scoring-grading-controller.ts` owns criteria/categories queries, criterion/category dialog state, archive mutation outcomes, and grading summary composition.
- `scoring-editor-controllers.ts` owns create/update mutation selection, submission busy/error state, dependent option queries, and successful dialog completion for rule, grading, and category editors.
- `scoring-model.ts` contains literal-friendly rule and criterion summary derivations.
- `scoring-columns.tsx` contains pure callback-driven rule and grading column factories.
- `scoring-summaries.tsx`, `scoring-rule-editor.tsx`, `scoring-grading-editor.tsx`, and `scoring-category-card.tsx` are focused views.
- `scoring-rules-page.tsx` and `scoring-grading-page.tsx` now only compose controllers and focused views.

### Contact drawer

- `contact-drawer-controller.ts` owns the interaction-triggered profile query, mutations, shared busy/error/tab state, profile/options/list refresh, and company cache refresh.
- `contact-drawer.tsx` is the keyed composition and sheet/header/loading shell.
- `contact-drawer-overview.tsx`, `contact-profile-form.tsx`, `contact-drawer-relations.tsx`, `contact-score-form.tsx`, and `contact-timeline-tab.tsx` isolate focused UI concerns.
- `contact-timeline-model.ts` performs the pure merge, label mapping, tone mapping, and descending timestamp sort for activity and score events.
- No generic CRUD abstraction was introduced.

## TDD evidence

Tests were written before their production modules and observed failing because the modules did not exist:

- `scoring-model.test.ts`: missing `scoring-model` (RED), then 2 summary tests green.
- `scoring-controllers.dom.test.tsx`: missing `scoring-controllers` (RED), then controller success/error and editor create/update behavior green.
- `contact-drawer-controller.dom.test.tsx`: missing `contact-drawer-controller` (RED), then mutation success/error/cache refresh and entity-change state green.
- `contact-timeline-model.test.ts`: missing `contact-timeline-model` (RED), then literal merged/sorted timeline behavior green.

The focused final suite contains 11 passing tests across those four files.

## Verification

- `pnpm --filter @openengage/client test`: 59 files, 212 tests passed.
- `pnpm --filter @openengage/client typecheck`: passed.
- `pnpm --filter @openengage/client build`: Vite client, SSR, OpenEngage server builds and final `tsc --noEmit` passed.
- `pnpm lint`: passed with no findings.
- `pnpm architecture:check`: 135 policy tests passed; 877 source files checked with no forbidden dependencies or cycles.
- Scoped `oxfmt --check`: 26 touched scoring/contact drawer files passed.
- `git diff --check`: passed.

## Mechanical audit

- All new/touched target entry/controller/view files are below 250 lines; largest is `contact-drawer.tsx` at 173 lines.
- All target functions/controllers are below 120 lines; the largest focused editor component is below 115 lines.
- No new prop-to-state synchronization effect exists in the slice.

## Self-review notes

- Replaced partial cast-based scoring fixtures with complete domain-shaped rows.
- Adjusted the contact cache-refresh test to assert the actual invalidation boundary because an active query immediately refetches and clears TanStack Query's transient `isInvalidated` flag.
- Extracted rule form parsing so the editor component satisfies the stricter 120-line function cap.
- No known concerns remain.

## Fix round 1: scoring prop-only views and dialog sessions

### Findings resolved

1. Split each scoring editor/card into a controller-backed composition shell and a prop-only view:
   - `ScoringRuleEditorShell` owns rule form parsing and `useScoringRuleEditorController`; `ScoringRuleEditorView` receives item, state, commands, categories, and tags only.
   - `GradingCriterionEditorShell` owns criterion form parsing and `useGradingCriterionEditorController`; `GradingCriterionEditorView` receives item, state, and commands only.
   - `ScoringCategoryCardShell` owns category form parsing and `useScoringCategoryEditorController`; `CategoryCardView` receives rows, supplied columns, dialog state, and commands only.
   - The three prop-only view modules import no query, mutation, controller, form parsing, or FormData APIs.
   - `scoringCategoryColumns` now lives beside the rule and grading factories in `scoring-columns.tsx`; the grading page constructs and supplies it.
2. Added explicit per-open session identity:
   - Rule create and edit commands increment `editor.sessionId`, including reopening the same existing rule.
   - Grading create and edit commands increment `criterionEditor.sessionId`, including reopening the same criterion.
   - Category closed-to-open transitions increment `categoryEditor.sessionId`.
   - Pages key each composition shell by its session ID, so controller error/conditional state and uncontrolled form drafts reset on every reopen while remaining stable within one open session.

### TDD and behavior coverage

- RED was observed with `pnpm --filter @openengage/client exec vitest run src/features/scoring/scoring-controllers.dom.test.tsx src/features/scoring/scoring-editor-shells.dom.test.tsx`:
  - the new shell module could not be resolved;
  - rule/grading session IDs were undefined;
  - the category editor session API did not exist.
- GREEN focused result: 2 files, 10 tests passed.
- `scoring-controllers.dom.test.tsx` proves fresh create, same-item edit, grading, and category session IDs.
- `scoring-editor-shells.dom.test.tsx` renders real shell/view forms and proves:
  - a rejected rule create retains its changed match field and error during the session, then reopening resets to `any` and clears the error;
  - a rejected update for the same grading criterion retains its custom-field state and error during the session, then reopening restores the item's original `stage` field and clears the error;
  - `CategoryCardView` renders supplied rows through supplied columns and delegates the open command without any query provider/controller hook.

### Fix verification

- Focused tests: 2 files, 10 tests passed.
- Full client tests: `pnpm --filter @openengage/client test` — 60 files, 217 tests passed.
- Client typecheck: `pnpm --filter @openengage/client typecheck` — passed.
- Client build: `pnpm --filter @openengage/client build` — Vite client/SSR/OpenEngage server builds and final TypeScript check passed.
- Full lint: `pnpm lint` — passed with no findings.
- Scoped format: `pnpm exec oxfmt --check apps/client/src/features/scoring` — all 18 files passed.
- Whitespace audit: `git diff --check` — passed.
- Mechanical line audit: all touched scoring entry/controller/shell/view/column/model files are at most 176 lines; all target functions/controllers are at most 108 lines.

### Fix self-review

- Removed a category-open method that existed only for tests; coverage now calls the same `onOpenChange(true)` command used by the real category view.
- The contact drawer, atomic contact create, export controller, and company invalidation behavior were not changed in this round.
- No remaining concerns for the two Important findings.
