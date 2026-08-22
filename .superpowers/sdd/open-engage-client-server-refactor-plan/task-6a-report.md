# Task 6A report

## Result

Decomposed the Website signup-form, landing-page, site-message, and redirect pages; Companies list/detail/enrichment; and Settings into focused entry, controller, model, view, dialog, and panel modules. Existing route imports and loader-prefetched suspense reads remain intact. The Companies query route now keys the list page by `q`, replacing prop-to-state synchronization with a keyed remount. Settings and Companies affordances continue to derive only from server capabilities; no client role comparison was introduced.

## TDD evidence

- RED: `pnpm --filter @openengage/client test -- ...resource-model.test.ts ...enrichment-selection-model.test.ts ...api-key-controller.dom.test.tsx` failed in the expected way because all three production modules were absent: 3 failed suites, 46 existing files passed, 171 existing tests passed.
- GREEN: `pnpm --filter @openengage/client exec vitest run src/features/website/resource-model.test.ts src/features/companies/enrichment-selection-model.test.ts src/features/settings/api-key-controller.dom.test.tsx` passed: 3 files, 10 tests.
- The new tests cover Website summary derivation and archive success/error outcomes, enrichment default/explicit selection behavior, and API-key controller success/error/busy state.
- Existing enrichment stale-request/session DOM tests and Company form behavior tests remained green after extraction.

## Files and boundaries

- Website: four thin `*-page.tsx` compositions, four resource controllers, four pure column/summary views, four focused editor dialogs, signup field view, and `resource-model.ts`.
- Companies: list/detail pages and controllers, pure columns, enrichment controller, candidate view, proposal review, and pure selection model. `companies-page.tsx` remains a compatibility entry. The enrichment capability queries/loaders remain unchanged.
- Settings: composition entry plus brand, 2FA, API-key, and workspace-info panels; stateful panels have focused controllers. 2FA continues to call the Better Auth client.
- Route contract changes: none. Only the Companies list component receives `key={q}`; Website and Settings loaders/routes were not changed.

## Size audit

- All reviewed Task 6A entry/controller/view production files are <=250 lines.
- Largest touched target production file: `company-forms.tsx`, 236 lines; largest new target file: `brand-panel.tsx`, 220 lines.
- Largest reviewed function/component: `SignupFormFields`, 113 lines. All reviewed controller/functions are <=120 lines; largest controller file is `enrichment-controller.ts`, 137 lines, with its main hook 101 lines.
- `site-tracking-page.tsx` remains 285 lines but was explicitly outside the reviewed 6A Website resource slice and was not touched.

## Verification

- Full client tests: 49 files, 181 tests passed.
- Client typecheck: passed (`tsc --noEmit`).
- Client production build: passed (Vite client/SSR and OpenEngage server environments, followed by TypeScript).
- Repository lint: passed (`oxlint .`).
- Task 6A format check: passed for 53 scoped files.
- `git diff --check`: passed.

## Concerns

- Repository-wide `pnpm format:check` still reports two pre-existing, out-of-scope files: `apps/client/src/routes/_app.reports.tsx` and `apps/client/src/routes/_app.settings.tsx`. They were left unchanged per the ownership constraint; every Task 6A file passes the formatter check.

## Fix round 1 — Important findings

### Result

- Website public URLs now come from the isomorphic `public-urls.ts` boundary (`getRequestUrl().origin` on the server and browser origin on the client). Controllers inject already-built URL functions into the pure table views; the views do not read `window`, `location`, or another global.
- `resource-model.ts` now contains deterministic summary functions only. Archive mutation orchestration and callbacks moved to the clearly named `resource-controller-actions.ts` boundary, with separate pure-model and effect-outcome tests.
- `settings-controller.ts` now owns the loader-prefetched email-brand suspense query and capability projection. `SettingsPage` is composition-only and passes controller data/commands into the panels.
- Controller behavior coverage now exercises the four Website resource controller variants, Companies list/detail dialog and mutation outcomes, brand save outcomes, and Better Auth 2FA setup/verification outcomes through real hooks and Query Client state.
- `SiteMessageScheduleFields` was extracted from `SiteMessageEditorDialog`; the dialog function is now 112 lines.

### RED evidence

- `resource-model.test.ts` plus the new SSR regression suite initially failed as expected: the new controller-actions import did not exist, and all three non-empty Website table renders threw `ReferenceError: window is not defined` from the cell renderers.
- `settings-controller.dom.test.tsx` initially failed to resolve `./settings-controller`, proving the suspense query still had no controller boundary.
- The brand/2FA controller suite initially had two 2FA failures: controller `error` was `undefined` after success and a rejected Better Auth call instead of the expected empty/error messages. Companies characterization tests were already green because the extraction behavior itself was preserved.
- A strengthened returned-error assertion then failed 1 of 32 focused tests because the Better Auth plain error object was reduced to the fallback message. The controller now preserves `result.error.message` while retaining the fallback and rejected-call handling.
- The first Website controller harness run exposed six missing Start request-context failures. Injecting an explicit public origin in the controller harness isolated the intended success/error behavior without weakening the production isomorphic default.

### GREEN evidence and verification

- Focused command: `pnpm --filter @openengage/client exec vitest run src/features/website/resource-model.test.ts src/features/website/resource-controller-actions.test.ts src/features/website/website-resource-ssr.test.tsx src/features/website/website-resource-controllers.dom.test.tsx src/features/companies/company-controllers.dom.test.tsx src/features/companies/company-enrichment-sheet.dom.test.tsx src/features/settings/settings-controller.dom.test.tsx src/features/settings/settings-panel-controllers.dom.test.tsx src/features/settings/api-key-controller.dom.test.tsx` — 9 files, 32 tests passed.
- Full client tests: 55 files, 201 tests passed.
- Client typecheck: passed (`tsc --noEmit`).
- Client production build: passed for the Vite client/SSR and OpenEngage server environments, followed by TypeScript.
- Repository lint: passed (`oxlint .`).
- Scoped format check: all 62 Website, Companies, and Settings files matched.
- `git diff --check`: passed.
- Boundary search: the three Website views contain no `window`, `globalThis`, or `location.origin`; `useSuspenseQuery` is absent from `settings-page.tsx` and owned by `settings-controller.ts`.

### Mechanical size audit

- AST audit covered 257 functions across 43 changed Task 6A production files: maximum 113 lines at `apps/client/src/features/settings/brand-panel.tsx:13`; 0 functions exceeded 120 lines.
- File audit covered the same changed production scope: largest file is `company-forms.tsx` at 236 lines, so every changed Task 6A entry/controller/view remains below 250 lines.

### Fix-round concerns

- None. The existing repository-wide format concern above remains out of scope and unchanged.
