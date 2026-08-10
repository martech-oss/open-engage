import type { ComponentProps, ReactNode } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export function FormInput({
  label,
  description,
  error,
  id,
  name,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Input>, "id"> & {
  label: string;
  description?: string;
  error?: string | undefined;
  id?: string;
  name: string;
}): ReactNode {
  const inputId = id ?? name;
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        id={inputId}
        name={name}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function FormTextarea({
  label,
  description,
  error,
  id,
  name,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "id"> & {
  label: string;
  description?: string;
  error?: string | undefined;
  id?: string;
  name: string;
}): ReactNode {
  const inputId = id ?? name;
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Textarea
        id={inputId}
        name={name}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function FormNativeSelect({
  label,
  description,
  error,
  id,
  name,
  disabled,
  children,
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, "id"> & {
  label: string;
  description?: string;
  error?: string | undefined;
  id?: string;
  name: string;
  children: ReactNode;
}): ReactNode {
  const inputId = id ?? name;
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <NativeSelect
        id={inputId}
        name={name}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        className="w-full"
        {...props}
      >
        {children}
      </NativeSelect>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export { NativeSelectOption as FormSelectOption };
