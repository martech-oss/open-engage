import { useQuery } from "@tanstack/react-query";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import type { AutomationDefinition } from "@openengage/core/automations";

import { automationExecutionOptionsQueryOptions } from "./automation-api";
export function AutomationContextSettings({
  definition,
  onChange,
}: {
  definition: AutomationDefinition;
  onChange: (value: AutomationDefinition) => void;
}) {
  const { data } = useQuery(automationExecutionOptionsQueryOptions());
  return (
    <div className="grid gap-4 border-b p-4 md:grid-cols-2 lg:px-8">
      <FormInput
        name="automationTimezone"
        label="フローのタイムゾーン"
        value={definition.timezone}
        onChange={(event) => onChange({ ...definition, timezone: event.target.value })}
      />
      <FormNativeSelect
        name="automationVariableProject"
        label="共通変数を解決する施策"
        value={definition.variableProjectId ?? ""}
        onChange={(event) =>
          onChange({ ...definition, variableProjectId: event.target.value || null })
        }
      >
        <FormSelectOption value="">ワークスペースの変数</FormSelectOption>
        {data?.projects.map((project) => (
          <FormSelectOption key={project.id} value={project.id}>
            {project.name}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
    </div>
  );
}
