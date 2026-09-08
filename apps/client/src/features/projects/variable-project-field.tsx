import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { FormNativeSelect, FormSelectOption } from "@/components/app-ui/form-fields";

import { variableProjectsQueryOptions } from "./variable-api";
export function VariableProjectField({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const projects = useQuery(variableProjectsQueryOptions()),
    id = useId();
  return (
    <FormNativeSelect
      id={id}
      name="variableProjectId"
      label="変数を解決するProject"
      description="リンク先や計測Projectにかかわらず、この設定で変数を解決します。"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <FormSelectOption value="">Workspaceの変数のみ</FormSelectOption>
      {projects.data?.map((project) => (
        <FormSelectOption key={project.id} value={project.id}>
          {project.name}
        </FormSelectOption>
      ))}
      {value && !projects.data?.some((project) => project.id === value) && (
        <FormSelectOption value={value}>{value}</FormSelectOption>
      )}
    </FormNativeSelect>
  );
}
