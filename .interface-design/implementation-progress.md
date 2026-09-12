# Monitoring UI implementation and validation

Implemented on `codex/monitoring-ui`, baseline `61e97a5`, 2026-09-12.

## Delivered

- Neutral light palette, compact controls, flat metric bands, shared table and header rules.
- Stable business navigation with section navigation; mobile navigation overlay closes on route selection.
- Monitor with existing attention items, explicit aggregation periods, delivery trend, flows and contact history; refresh errors retain data.
- Searchable flow comparison table and one creation menu; list search/status retained through editor navigation.
- Contact history first, fixed identity header, independent detail scroll, separated filters and selection operations.
- Searchable project table, published outcomes / unpublished settings, grouped settings and page operation menu.
- Consistent report periods/populations/empty rates and numerical alignment; compact period controls.
- Email creation menu and content-first editing; existing canvas, permissions and mutation logic retained.
- Shared table controls no longer accidentally trigger parent row navigation.

## Automated checks

- Client: 96 test files / 405 tests passed (baseline 88 files / 370 tests).
- Client production build, bundle boundary checks and TypeScript passed.
- Repository lint and unused-export check passed.
- Architecture: 1214 source files, no forbidden dependencies or cycles.
- Added regression coverage for monitor refresh failures and attention semantics, navigation selection, flow creation/search, default contact history, project default views/query context, email creation, empty report rates, and embedded table controls.

## Browser verification

Before/after comparison used archived baseline and current real components with explicit synthetic fixtures in a separate Vite harness. Verified desktop 1280/1440 and mobile 390 widths, plus 720×450 reflow equivalent to the available content area at 200% on a 1440×900 display. Browser zoom keyboard shortcuts have no effect in the in-app browser, so actual browser zoom was not independently verified.

Confirmed search zero-results and keyboard clearing, all four flow creation choices, published project outcomes, compact report filters, local table horizontal scrolling (body width remains390), mobile navigation closure, contact history opening, pointer/Escape closing, and focus return to the original contact trigger. Empty monitor collapses attention to one line. Refresh failure/stale data and permission-dependent operations are covered by DOM tests; synthetic preview blocks backend mutations.

## Runtime limitation

The existing Cloudflare Vite dev path fails before the UI renders due to css-tree relative JSON resolution. Production build passes, but worker preview also encounters createRequire with an undefined import.meta.url path. No workaround config was retained. Consequently real-backend creation/editing/publication was not browser-tested. No public API or DB changes, no deployment, no commits.

## Preview coverage repair (2026-09-12)

Replaced the partial temporary router after company/list/segment omissions were reported. `apps/client/preview` now imports the real generated route tree and runs real page loaders and search validation. The SSR document shell, authentication and RPC transport are the only substitutions. All navigation destinations are included automatically. Fixtures fail explicitly when missing; writes are blocked in both RPC styles.

Verified every main/secondary menu entry and all report views in the browser, along with company, list, segment, project and automation details. Checked project participants/settings and automation execution history. Added48 passing preview regression tests to the standard client test command; existing405 client tests, production build/TypeScript, lint, unused export check and architecture validation pass.

Restart with `pnpm --filter @openengage/client dev:preview` on127.0.0.1:5182. The visible sample-data label and `preview/README.md` explain which catalogs intentionally start empty. Real backend startup limitations above remain separate from this complete UI route preview.
