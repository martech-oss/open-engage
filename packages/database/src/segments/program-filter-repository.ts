import {
  compileSegmentFilter,
  segmentFilterSchema,
  type SegmentFilter,
} from "@openengage/core/segments";
/** All program SQL is owned by the database boundary; consumers share this compiler. */
export function compileWorkspaceSegmentFilter(workspaceId: string, filter: SegmentFilter) {
  return compileSegmentFilter(workspaceId, segmentFilterSchema.parse(filter), {
    project_member: {
      query:
        "FROM project_members pm WHERE pm.workspace_id = c.workspace_id AND pm.contact_id = c.id",
      qualifier: (condition, params) => {
        if (!condition.program) return undefined;
        params.push(condition.program.projectId, condition.program.definitionVersion);
        return "pm.project_id = ? AND pm.definition_version = ?";
      },
      columns: {
        project_id: "pm.project_id",
        project_status: "pm.status_id",
        project_success: "(pm.first_success_at IS NOT NULL)",
        project_joined_at: "pm.joined_at",
        project_success_at: "pm.first_success_at",
      },
    },
  });
}
