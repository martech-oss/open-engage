# Workspace / Project variables

Variables define reusable display text and typed configuration. Manage Workspace defaults in **Settings → Workspace変数**, and local overrides in **Projects → Variables**. A Project may introduce its own key. A same-key Project definition overrides the Workspace value; it must keep the same type. Existing key types are immutable while any definition uses that key. Edits require the current revision and show a usage / publication diff before saving.

Deleting a definition retains a hidden tombstone and advances its revision. Recreating the same scope/key with `expectedRevision: 0` revives it with a higher revision, so an editor holding a pre-deletion revision cannot overwrite or delete the replacement. Deleted definitions do not participate in inheritance, clone capture, or active type checks. A key can change type only when no active definition of another type remains.

Supported types are `string`, finite `number`, `boolean`, zoned ISO `datetime`, and absolute `http(s)` `url` without credentials. Variable values cannot contain recursive `{{…}}` expressions or execute scripts.

Use `{{variables.key}}` in LP display text, HTML text nodes, CTA labels, form field labels, and completion messages. HTML values are escaped and the normal sanitizer still runs. HTML attributes, CSS and scripts reject interpolation. CTA URLs use an explicit reference instead:

```json
{ "kind": "variable", "key": "registration_url", "type": "url" }
```

The LP editor's **表示文・CTA・変数** section selects this URL reference, and supports saving a new draft after a variable change. Number, boolean, datetime and URL settings in Automation use the same typed reference model. Resource IDs are never replaced. The Automation integration owns the exact supported setting list.

Every resource selects one variable Project independently of resource links and measurement attribution. An LP's `document.variableProjectId` and a standalone form's `variableProjectId` are explicit. Shared forms retain their own configured variable Project even when embedded in a differently configured LP. New forms owned by an LP receive the LP's explicit variable context. Callable Automation children inherit the parent context when the parent captures its dependencies.

Publication validates missing variables, type mismatches, resolved field limits and URLs. It captures values, definition IDs, revisions and Project context. Changing a variable does not edit a published resource or an existing execution. Create/save a new draft and publish it to apply new values. Returning to an old LP version restores its original values and form bindings. Draft preview resolves current values and displays missing-variable diagnostics without publishing.

LP versions retain the source `document` and store the resolved sanitized `publishedDocument` separately, with `variableSnapshot`. Both forms and form versions retain `sourceDefinition` / `sourceSuccessMessage`; their public definition and message contain resolved text. Form versions also record `publishedAt`, `variableProjectId`, `variableSnapshot` and a frozen `programBinding` for pinned form registration. Cloning should use the chosen version's source fields, remap context and clear publication / variable snapshots before the normal publish step.

The typed oRPC interface exposes `projects.variablesList`, `variablesSave`, `variablesDelete`, `variablesUses`, and `variablesImpact`; REST / SDK share these contracts. Listing includes effective values, local/inherited definitions and a server-derived `canEdit` capability. Uses and impacts include draft/current and published LP, form and Automation versions. Impact compares the proposed value with each published snapshot; an effective Project override can leave a Workspace edit's impact unchanged. Snapshot records themselves remain immutable.

Usage records identify the owning resource/version and include a `dependencyPath` for shared forms (`form:<refId>`) and nested callable sites (`call:<nodeId>`). A published LP uses its pinned form's context/snapshot; a draft uses the shared form's current explicit context. Callable draft analysis follows the published child and its pinned descendants under the parent's context, while published before values come from the parent's captured dependency snapshots. These paths, contexts and per-resource `diagnostics` appear in the uses/diff UI. Malformed draft expressions retain valid references in the same field and do not block unrelated variable edits; publication still rejects malformed syntax.
