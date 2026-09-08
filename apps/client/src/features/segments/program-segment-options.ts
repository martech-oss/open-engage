import type {
  SegmentField,
  SegmentGenerationCatalog,
  SegmentResourceOption,
  SegmentCondition,
} from "@openengage/core/segments";
export function programStatusSelection(condition: SegmentCondition): string {
  const program = condition.program;
  return program
    ? JSON.stringify([
        program.projectId,
        program.definitionVersion,
        Array.isArray(condition.value) ? condition.value[0] : condition.value,
      ])
    : String(condition.value ?? "");
}
export function programSegmentOptions(
  field: SegmentField,
  catalog: SegmentGenerationCatalog,
): SegmentResourceOption[] | null {
  if (field === "project_id") return catalog.projects ?? [];
  if (field === "project_status") {
    const options = catalog.projectStatuses ?? [];
    const ids = [
      ...new Set(
        options
          .map((option) => option.programStatus?.statusId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    return [
      ...ids.map((id) => ({ id: `all:${id}`, value: id, name: `全施策・全定義版 / ${id}` })),
      ...options,
    ];
  }
  if (field === "project_success")
    return [
      { id: "0", name: "未達成", value: "0" },
      { id: "1", name: "達成", value: "1" },
    ];
  return null;
}
