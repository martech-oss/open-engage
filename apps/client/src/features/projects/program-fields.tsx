import type { ComponentProps } from "react";

import { FormNativeSelect, FormSelectOption } from "@/components/app-ui/form-fields";
export function ProgramSelect({
  options,
  ...props
}: Omit<ComponentProps<typeof FormNativeSelect>, "children"> & {
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <FormNativeSelect {...props}>
      {options.map((option) => (
        <FormSelectOption key={option.value} value={option.value}>
          {option.label}
        </FormSelectOption>
      ))}
    </FormNativeSelect>
  );
}
