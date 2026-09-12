# UI preview

Start with `pnpm --filter @openengage/client dev:preview`, then open http://127.0.0.1:5182/segments. Stop with Ctrl+C.

This preview uses the real generated route tree, page components, loaders, search parsing, redirects and navigation. Only the SSR document shell, authentication client and RPC transport are replaced. No backend is contacted; saving, publication, AI generation and external writes are blocked. The fixed sample clock is 2026-09-12 15:00 Asia/Tokyo. A visible label distinguishes sample data from the real application.

The monitor, contacts, companies, lists, segments, projects and flows have sample records. Other catalogs initially show their real empty states. Report data is validated against the corresponding output schema; categories without sample activity display zero counts and absent-denominator rates. `?state=empty` and `?state=error` support state checks on a full reload.

`pnpm --filter @openengage/client test:preview` checks every primary/secondary navigation destination, every report view, representative detail routes, legacy redirects, missing RPC fixtures, and write blocking. It also runs as part of the client's standard `test` command. New menu entries are automatically included. Unknown fixtures throw explicit errors instead of silently returning an incompatible generic object.

Keep preview fixtures and adapters here. Do not add separate hand-written page route registrations: importing `src/routeTree.gen.ts` is what prevents the omissions that previously broke companies, lists and segments.
