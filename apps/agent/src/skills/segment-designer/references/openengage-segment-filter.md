# OpenEngage SegmentFilter Reference

Read this reference before producing dynamic segment JSON.

## Structure

A filter is one condition or a recursive group. A group contains 1–25 children.

```json
{
  "kind": "group",
  "combinator": "and",
  "children": [
    {
      "kind": "condition",
      "field": "status",
      "operator": "eq",
      "value": "active"
    }
  ]
}
```

A condition always contains `kind`, `field`, `operator`, and `value`. Add `key` only for keyed fields. Use `null` for scalar, event, and custom-field `exists`/`not_exists`. Relationship fields retain the selected resource value for these operators.

## Fields and operators

| Field                                                                         | Value meaning                                   | Allowed operators                                                    | Key                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- | ---------------------- |
| `email`, `first_name`, `last_name`, `phone`, `external_id`, `stage`, `status` | Text                                            | `eq`, `neq`, `contains`, `starts_with`, `in`, `exists`, `not_exists` | Omit                   |
| `score`                                                                       | Number                                          | `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, `not_exists`  | Omit                   |
| `created_at`, `updated_at`                                                    | ISO date/time string                            | `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, `not_exists`  | Omit                   |
| `tag`                                                                         | Tag slug                                        | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `segment`                                                                     | Static segment slug                             | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `company`                                                                     | Company name                                    | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `subscription`                                                                | Subscription-topic slug; match means subscribed | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `event`                                                                       | Contact has an event of the type in `key`       | `eq`, `neq`, `exists`, `not_exists`                                  | Required event type    |
| `custom_field`                                                                | Contact JSON custom-field value                 | All supported operators                                              | Required JSON-path key |

Supported operators are `eq`, `neq`, `contains`, `starts_with`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, and `not_exists`.

## Value rules

- Values may be a string, number, boolean, string/number array, or `null`.
- Use a non-empty array for `in`.
- Use `null` for scalar, event, and custom-field unary existence checks. For `tag`, `segment`, `company`, and `subscription`, keep the selected resource value.
- For `event`, put the semantic event name in `key`; the compiler matches both system event types and API/Webhook custom-event names and ignores `value`.
- Keep custom-field keys to letters, digits, `_`, `.`, and `-`; schema validation and database compilation reject other JSON-path characters.
- `neq` and `not_exists` on relationship fields compile as absence of the relationship.

## Consent and suppression

- A `subscription` condition can require membership in a supplied topic slug with subscribed status.
- Global suppression and delivery frequency are enforced outside `SegmentFilter`. Record them as delivery guardrails and unresolved checks, never as unsupported fields.
- Structural validation does not prove that a tag, segment, company, topic, event type, or custom-field key exists in a workspace.

## Sales and related rows

Groups may specify `relation: "company" | "deal" | "event"`. All child conditions in that group match the SAME related row. Use `negated: true` on a deal group with `deal_status eq "open"` to require NO open deal. Do not express absence with a scalar `deal_status neq "open"`: that means a different existing deal. `minimumCount` on an event group requires at least that many matching events; combining it with `negated` expresses fewer than that count.

Additional fields: `category_score` (number, key = ID from catalog.categories; missing score is zero), `owner_user_id`, `lifecycle_stage`, `company_name`, `company_custom_field` (key from catalog.companyCustomFields), `deal_status` (open/won/lost), `deal_stage_id` (from catalog.dealStages), `deal_owner_user_id`, `deal_value` (number). Archived deals are excluded. Event fields are `event_type`, `event_resource_type`, `event_resource_id`, `event_occurred_at` (ISO date), `event_age_minutes` (number relative to current database time), and `event_property` (safe JSON-path key). Text/date/numeric operators follow the same rules as contact fields. Use a single event group for a recent form submission: event_type eq form_submitted AND event_resource_id eq the form ID AND event_age_minutes lte 1440. Category thresholds are chosen explicitly by the user; there is no universal MQL score threshold. Lifecycle stage is independent of the legacy free-text stage.

Related groups cannot nest another explicit relation scope. Nested AND/OR groups inherit the enclosing same-row scope; counts apply only on the outer relation group. Deal stage IDs support eq/neq/in/exists/not_exists. Arrays are valid only with in.
