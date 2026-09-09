import { useQuery } from "@tanstack/react-query";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";

import { reportProjectOptions, reportOwnerOptions, type ReportSearch } from "./report-api";

export function ReportFilterFields({ search }: { search: ReportSearch }) {
  if (search.view === "acquisition")
    return (
      <FormInput
        label="商談・受注の通貨（換算なし）"
        name="currency"
        maxLength={3}
        pattern="[A-Za-z]{3}"
        defaultValue={search.currency || "JPY"}
        required
      />
    );
  if (search.view === "campaigns")
    return (
      <>
        <FormInput
          label="通貨（合算・換算なし）"
          name="currency"
          maxLength={3}
          pattern="[A-Za-z]{3}"
          defaultValue={search.currency || "JPY"}
          required
        />
        <FormNativeSelect
          label="売上配賦"
          name="attributionModel"
          defaultValue={search.attributionModel ?? "last_touch"}
        >
          <FormSelectOption value="last_touch">最終接点</FormSelectOption>
          <FormSelectOption value="first_touch">初回接点</FormSelectOption>
        </FormNativeSelect>
      </>
    );
  return search.view === "lifecycle" ? <LifecycleFilters search={search} /> : null;
}
function LifecycleFilters({ search }: { search: ReportSearch }) {
  const { data: projects = [] } = useQuery(reportProjectOptions());
  const { data: options } = useQuery(reportOwnerOptions());
  return (
    <>
      <FormNativeSelect label="プロジェクト" name="projectId" defaultValue={search.projectId ?? ""}>
        <FormSelectOption value="">すべて</FormSelectOption>
        {projects.map((project) => (
          <FormSelectOption value={project.id} key={project.id}>
            {project.name}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
      <FormNativeSelect
        label="現在の連絡先担当者"
        name="ownerUserId"
        defaultValue={search.ownerUserId ?? ""}
      >
        <FormSelectOption value="">すべて</FormSelectOption>
        {options?.members.map((member) => (
          <FormSelectOption value={member.id} key={member.id}>
            {member.name}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
    </>
  );
}
