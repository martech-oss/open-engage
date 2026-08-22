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
