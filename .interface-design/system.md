# OpenEngage — monitoring workspace

## Intent and signature

For marketers reviewing delivery health, campaign outcomes and contact engagement before choosing an action. Each view follows **status → trend → records → contact history**. The monitor leads with existing failures/overdue work; flow lists compare progression; contact details start with history; published campaigns start with outcomes; reports pair metrics with their actual population and time range.

## Palette and depth

Light theme. Canvas/sidebar #F7F8FA, working surface #FFFFFF, primary text #20252B, secondary #485360, metadata #626D7A, disabled #89929D. One action/selection accent #2457C5. Status colors green #24734E, amber #A36916, destructive #BC303B; always accompanied by labels. Border #E1E5EB, table hairline #EDF0F4; borders define structure, no card elevation effects. Inputs use independent #F2F4F7 fill and #CBD2DB border. Focus uses the primary color. Primitive colors live only in styles.css; consumers use semantic tokens.

## Type and geometry

Geist Variable + Noto Sans JP Variable, body14, metadata12, section16 semibold, page24 semibold; tabular figures. 4px spacing unit. Sidebar224px, header minimum56px (wraps for accessibility), desktop gutters24px/mobile16px. Table rows40px, two-line contact/flow rows56px. Input/button40px default, secondary36px, small icon controls32px; touch contexts enlarge hit areas. Radius4px controls,8px panels,12px dialogs. Low contrast structural lines; text contrast checked separately from separators.

## Reusable patterns

- PageLayout: min-width0 flexible work area, fixed title/actions, scrolling content; non-fill content must not flex-shrink.
- AppShell: stable primary navigation, horizontally scrolling section navigation; existing URL destinations unchanged. Below768px navigation is a Sheet.
- MetricGrid/MetricCard: one flat comparison band with label12, value24 semibold, note12. No repeated colored icon tiles.
- DataTable: common column visibility/sorting/filter affordances; numerical columns right aligned. Pagination retains server sorting authority. Embedded controls never trigger record opening. Keyboard Enter on a focused row opens the record.
- ContactDrawer: fixed identity/company/score and tabs, history initially selected, tab body scrolls independently. Mobile full-width overlay; close returns focus.
- Flow creation: one primary menu, four entry paths (blank, template, AI, AI sequence). Query/status travel with editor navigation and return links.
- Published campaign: outcomes/participants/settings; unpublished campaign: settings first. Definition/forms/brief/variables stay under settings; clone under page actions.
- Contextual help: glossary definitions, rate formulas and methodology live in HelpTooltip beside the relevant label or heading; no persistent explanatory panels. Open by hover, keyboard focus or tap, dismiss with Escape or outside interaction, retain focus. Keep selected periods, units, live denominators and actionable errors visible.
- Rates: absent denominator displays —; missing comparison displays 比較データなし. Never turn missing data into zero.
- Monitor: manual refresh with API asOf + timezone. Refetch errors retain the last data. Distinct API periods remain visible. Sent minus delivered is 到達未確認, not confirmed failure. Flow updatedAt is 更新日時.

## Motion and verification

Only interaction-driven overlay transitions; no row, KPI, chart entrance animation. Respect reduced motion. Verify1440/1280 desktop,768 boundary,390 mobile and200% zoom. Test empty/search-empty/loading/error/refresh-error states, long names/large figures, permissions, focus return and maintained list context.

## Validation environment

Worker-backed Vite startup currently fails in css-tree module resolution, before UI changes. Before/after visual checks use actual component source and synthetic fixtures in a separate local Vite harness; backend mutations are blocked there. Production build and repository tests validate the real app independently. No API/DB migration and no deployment.
