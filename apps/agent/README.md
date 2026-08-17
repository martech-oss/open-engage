# agent

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
pnpm install
```

Then add a model provider API key to `.env` (any [provider Pi supports](https://pi.dev/docs/latest/providers#api-keys)).

## Talk to your agent

```sh
pnpm exec flue run src/agents/hello.ts --message "Say hello!"
pnpm exec flue run src/agents/hello.ts --message "Design an onboarding automation for trial users"
pnpm exec flue run src/agents/hello.ts --message "Map the journey from signup to first value"
pnpm exec flue run src/agents/hello.ts --message "Define a dynamic segment for active trial users"
pnpm exec flue run src/agents/hello.ts --message "Compile that brief into an OpenEngage automation flow"
pnpm exec flue run src/agents/hello.ts --message "Draft a three-email win-back sequence"
pnpm exec flue run src/agents/hello.ts --message "Create a GA4 tracking plan for trial activation"
```

Conversations are durable — pass `--id <id>` to continue one.

## Skills

The Hello agent mounts six progressively disclosed skills:

- `marketing-automation` turns a broad acquisition or lifecycle goal into one operational brief with an audience, trigger, flow, owner, and measurement plan.
- `customer-journey-map` maps stages, touchpoints, emotions, friction, critical moments, and prioritized improvements.
- `segment-designer` turns targeting requirements into a static membership design or validated dynamic `SegmentFilter` JSON.
- `automation-flow-designer` compiles a brief and segment into validated `AutomationDefinition` graph JSON with unresolved resource IDs called out.
- `email-sequence` designs complete multi-email copy, cadence, branches, exits, measurement handoffs, and OpenEngage delivery-capability status.
- `analytics-tracking` creates a GA4-first event, Key Event, attribution, implementation, and QA plan with an OpenEngage compatibility appendix.

The schema-validation tools use `@openengage/core` as the source of truth. They only validate and normalize supplied JSON: they do not query IDs, create segments, templates, or automations, publish flows, or make any API call.

The internal `SegmentDesigner` agent uses the same segment skill with a trusted workspace catalog and submits a structured proposal. The Server Worker revalidates resources and measures the audience before the management UI lets a marketer apply it; the agent never saves a segment directly.

The internal `EmailSequenceDesigner` agent combines the email-sequence, email-template, and automation-flow skills into a validated bundle. The Server Worker owns resource checks and atomic draft creation; the agent never persists or publishes the generated templates or automation.

The agent has a lightweight in-memory sandbox for drafting Markdown. Workspace files are temporary and are not exposed as downloadable artifacts, so the agent always returns the complete result in the conversation. General agents have no network tools. The private `CompanyEnrichment` agent is the exception: it exposes only bounded, read-only AI Gateway Web Search and official-site inspection tools, with Cloudflare Playwright used as a fallback for JavaScript-rendered pages.

## Develop

```sh
pnpm run dev
```

The private Hello agent is mounted at `/api/agents/hello` and is reached through the Server Worker's authenticated Service Binding gateway. Local Vite diagnostics listen on Flue's default port `3583`.

## Deploy

Register the model provider key as a Worker secret, then deploy:

```sh
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm run deploy
```

Company enrichment uses the `AI` and `BROWSER` bindings in `wrangler.jsonc`. It requires Cloudflare AI Gateway Unified Billing credits and Browser Run quota; it does not require an additional browser provider or MCP Worker.

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `pnpm exec flue docs` from the terminal.
