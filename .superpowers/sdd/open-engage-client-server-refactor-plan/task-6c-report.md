# Task 6C report

## Status

Completed the reviewed Task 6C slice without changing server validation or route contracts.

## TDD evidence

- RED: the segment AST, email document command, and query invalidation suites failed because the new pure modules did not exist.
- RED: the paginated DataTable behavior test failed because a server-paginated page still exposed current-page sorting.
- RED: the nested invalid AST path identity test failed because replacement rebuilt an unchanged parent.
- GREEN: focused Task 6C suites pass with 46 tests; the final full client suite passes with 247 tests across 66 files.

## Implementation

- Extracted immutable segment defaults, append/replace/remove commands, raw values, catalog options, and custom-field operator normalization into a pure model with literal edge-case tests.
- Split the segment builder into entry, recursive node, condition, and value editors; the interactive draft remains owned by the client form and existing preview/server validation is unchanged.
- Extracted email block defaults plus immutable add/update/move/delete commands into a pure model and split theme, block list, nested block, and leaf editors.
- Changed both email asset picker entry points to conditional `React.lazy` mounts. The production build emits a separate `asset-picker` chunk.
- Split touched segment/email API responsibilities into query and mutation modules behind compatibility barrels. Added a typed, deduplicating query-root invalidation helper and mutation cache tests.
- DataTable now derives local sorting authority from the absence of pagination: complete small lists retain local sorting, while paginated lists preserve server/URL ordering.

## Verification

- `pnpm exec vitest run ...Task 6C focused files...`: 46/46 passed.
- `pnpm --filter @openengage/client test`: 247/247 passed in 66 files.
- `pnpm --filter @openengage/client typecheck`: passed.
- `pnpm --filter @openengage/client build`: passed.
- `pnpm lint`: passed.
- `pnpm architecture:check`: 135 policy tests passed; 902 source files checked.
- Scoped `oxfmt --check`: passed for 53 matching files.
- Line audit: largest touched TSX entry/view/editor is 211 lines; largest touched controller/editor function is 112 lines.
- `git diff --check`: passed.

## Concerns

None.

## Fix round 1: deterministic segment defaults and literal edges

- Replaced the ambient `new Date()` default with a required `SegmentDefaultValues.dateTimeLocal` input throughout the pure segment model.
- The segment form derives that value from the workspace render clock with `toDateTimeLocal(renderedAt)` and passes it through the builder/editor boundary.
- Corrected keyed-option selection so custom-field metadata cannot override ordinary fields such as `created_at`.
- Added hand-derived literal coverage for deterministic injected dates, boolean defaults, empty catalog fallbacks, nested condition/group append, invalid append paths, and append attempts targeting conditions.
- No-op append assertions verify root identity preservation; identical catalog/default inputs produce the exact same date AST.
- RED evidence: the injected `2026-01-02T10:30` date test received `"0"` before the fix, exposing both ambient time and the custom-field metadata leak.
- Focused model/editor verification: 23/23 passed across 3 files.
- Full client verification: 252/252 passed across 66 files.
- Client typecheck/build, repository lint, architecture check (135 policy tests; 903 source files), and scoped format check passed.
- Production line audit: all touched files are at most 199 lines; the largest touched controller/editor function is 114 lines.
- Pure-model ambient-source audit: no `Date`, `Intl`, or `window` references remain in `segment-builder-model.ts`.
