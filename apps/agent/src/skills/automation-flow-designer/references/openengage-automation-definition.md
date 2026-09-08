# OpenEngage AutomationDefinition Reference

Read this reference before producing automation JSON.

## Root

```json
{
  "name": "Trial onboarding",
  "description": "Move new trials toward first value.",
  "timezone": "UTC",
  "nodes": [],
  "edges": []
}
```

- `name`: 1–191 trimmed characters.
- `description`: at most 2,000 characters; defaults to an empty string.
- `timezone`: non-empty string; defaults to `UTC`.
- `nodes`: 1–500 nodes.
- `edges`: at most 1,000 edges.

Every node has a non-empty `id`, a `type`, numeric `position.x` and `position.y`, and a type-specific `config`.

## Source nodes

Use exactly one source node.

| `config.source`    | Required config           | Re-entry                                     |
| ------------------ | ------------------------- | -------------------------------------------- |
| `segment_joined`   | `segmentId`               | `once` or `every_time`; default `once`       |
| `form_submitted`   | `formId`                  | `once` or `every_time`; default `once`       |
| `contact_created`  | —                         | `once` only                                  |
| `api_event`        | `eventName` (1–120 chars) | `once` or `every_time`; default `every_time` |
| `webhook_event`    | `eventName` (1–120 chars) | `once` or `every_time`; default `every_time` |
| `contact_inactive` | `days` (1–3,650)          | `once` only                                  |

Example:

```json
{
  "id": "source-1",
  "type": "source",
  "position": { "x": 0, "y": 0 },
  "config": { "source": "segment_joined", "segmentId": "segment-id", "reentry": "once" }
}
```

## Action nodes

Set `type` to `action` and choose one config:

- `send_email`: `templateId`, optional `topicId`.
- `send_webhook`: `endpointId`.
- `add_tag` / `remove_tag`: `tagId`.
- `add_segment` / `remove_segment`: `segmentId`.
- `change_score`: integer `amount`.
- `update_field`: `field` (1–191 chars) and JSON-compatible `value`.

Publishing an email action requires a real published, unarchived transactional template. Structural validation cannot verify that requirement or any other referenced resource ID.

## Condition nodes

Set `type` to `condition`. The preferred config is `{ "filter": SegmentFilter }` with the shared nested AND/OR conditions, related company/deal/event/project_member row scope and minimumCount. Legacy scalar config `{ "field", "operator", "value" }` remains readable. Operators are `eq`, `neq`, `contains`, `starts_with`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, and `not_exists`. Prefer documented OpenEngage scalar contact fields. Use the filter form for keyed custom fields, behavioral periods/counts, category scores and Project membership.

A condition must branch with `yes` and/or `no` edges.

## Decision nodes

Set `type` to `decision`. Config contains:

- `event`: `opened`, `clicked`, `replied`, `page_viewed`, `form_submitted`, or `custom_event`.
- optional `resourceId`.
- `withinMinutes`: positive integer up to 525,600.

A decision may branch with `yes`, `no`, and `timeout` edges.

## Delay nodes

Set `type` to `delay` and choose one config:

- Relative: `{ "mode": "relative", "minutes": 1..525600 }`.
- Absolute: `{ "mode": "absolute", "at": "ISO-8601 datetime" }`.
- Window: `{ "mode": "window", "minutes": 1..525600, "weekdays": [0..6], "startHour": 0..23, "endHour": 1..24 }`.

## Edges and graph rules

Each edge is `{ "id", "source", "target", "branch" }`.

- Source, action, and delay nodes use `next`.
- Condition nodes use `yes` or `no`.
- Decision nodes use `yes`, `no`, or `timeout`.
- Keep node IDs and edge IDs unique.
- Reference existing endpoints only.
- Ensure exactly one source, no cycles, and all nodes reachable from the source.
- Do not create two outgoing edges with the same branch from one node, the core graph validator rejects that ambiguity.

## Execution controls and publication

- `variableProjectId: string | null` explicitly selects Project variable overrides (null means Workspace). Callable children inherit the parent's resolved context.
- Sources also support `batch` (`audience` + `schedule`), `callable`, and `project_member_joined` / `project_member_progressed` / `project_member_succeeded` (`projectId`).
- `audience`: `{kind:"segment",segmentId}` for a static list, or `{kind:"filter",filter:SegmentFilter}`.
- `schedule`: `{kind:"now"}` (manual), `{kind:"once",at:ISO}`, `{kind:"daily",hour,minute}`, `{kind:"weekly",weekdays:[0..6],hour,minute}`, `{kind:"monthly",day:1..31,hour,minute}`. All use graph timezone; nonexistent monthly days clamp to month end; DST gaps skip and folds run first occurrence. Missed slots collapse to latest one.
- Source `reentry`: once/every_time/cooldown. Cooldown requires positive cooldownMinutes, measured from the last enrollment start across all published versions.
- `upsert_project_member`: projectId and optional statusId; normal forward progress only. Use published program statuses.
- `change_score`: amount plus optional operation add/set (default add), categoryId (default overall). Negative add amounts subtract.
- `call_automation`: automationId selected from callableAutomations, mode await/async. Await blocks until child flow completion and propagates failure/cancellation; async continues immediately. Explicit cancellation cascades to descendants. Webhook completion means accepted for delivery.
- Publishing pins all callable versions and variables. Child republishing changes no existing parent; republish parent to adopt changes. Cycles and cross-workspace references are rejected.
- Typed VariableRef `{kind:"variable",key,type}` supports number for delay minutes / decision withinMinutes / score amount; datetime for delay at; string for handoff title; scalar types for update_field value. String literals support `{{variables.key}}`. Resource IDs are never substituted.
