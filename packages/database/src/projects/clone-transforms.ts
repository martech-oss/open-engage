import type {
  ProjectCloneOptions,
  ProjectCloneReferenceMap,
  ProjectCloneResourceKind,
} from "@openengage/core/projects";
type Row = Record<string, unknown>;
type Transform = (
  row: Row,
  source: Row,
  map: ProjectCloneReferenceMap,
  options: ProjectCloneOptions,
) => void;
const draft: Transform = (row) => {
  row.status = "draft";
};
const unchanged: Transform = () => {};
/** Adding a clone kind must explicitly choose its reset/retention semantics. */
export const projectCloneTransforms = {
  project: (row, _source, _map, options) => {
    row.name = options.name;
  },
  brief: (row, _source, _map, options) => {
    Object.assign(row, {
      status: "draft",
      revision: 1,
      rowVersion: 1,
      ownerUserId: options.ownerUserId,
      approverUserId: options.approverUserId,
      reviewAt: options.reviewAt,
      submittedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      completedAt: null,
    });
  },
  automation: draft,
  automation_version: (row) => {
    Object.assign(row, { status: "draft", version: 1 });
    if ("dependencies" in row) row.dependencies = "{}";
    if ("pinnedDependencies" in row) row.pinnedDependencies = "{}";
  },
  form: draft,
  landing_page: draft,
  experiment: (row) => {
    Object.assign(row, { status: "draft", winnerVariantId: null, startedAt: null, endedAt: null });
  },
  segment: (row) => {
    Object.assign(row, {
      memberCount: 0,
      evaluatedAt: null,
      evaluationStatus: row.kind === "dynamic" ? "pending" : "ready",
      evaluationError: null,
      filterVersion: 1,
    });
  },
  redirect: (row) => {
    Object.assign(row, { clickCount: 0, status: "draft" });
  },
  email_sequence: (row) => {
    Object.assign(row, {
      draftRevision: 1,
      publishedSubject: null,
      publishedContent: null,
      publishedRevision: null,
      publishedAt: null,
    });
  },
  variable: (row, _source, _map, options) => {
    row.revision = 1;
    row.deletedAt = null;
    const key = String(row.key);
    if (Object.hasOwn(options.variables, key)) row.value = JSON.stringify(options.variables[key]);
  },
  program: (row) => {
    Object.assign(row, { rowVersion: 1, publishedVersion: null });
  },
  form_version: (row) => {
    row.programBinding = null;
  },
  form_binding: (row, source, map) => {
    if (map.ids[String(source.projectId)]) row.definitionVersion = null;
  },
  landing_page_version: unchanged,
  dynamic_content: unchanged,
} satisfies Record<ProjectCloneResourceKind, Transform>;
