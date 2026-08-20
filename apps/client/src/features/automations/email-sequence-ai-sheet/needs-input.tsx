import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { EmailSequenceGenerationResult } from "@openengage/core/automations";

import { OMIT_VALUE } from "./resolutions";

export function NeedsInput({
  result,
  values,
  onChange,
}: {
  result: Extract<EmailSequenceGenerationResult, { status: "needs_input" }>;
  values: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Info />
        <AlertTitle>追加情報が必要です</AlertTitle>
        <AlertDescription>{result.summary}</AlertDescription>
      </Alert>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {result.plannedSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <FieldGroup>
        {result.requests.map((request) => (
          <Field key={request.requestId}>
            <FieldLabel>{request.label}</FieldLabel>
            {request.inputType === "resource" ? (
              <NativeSelect
                value={values[request.requestId] ?? ""}
                onChange={(event) =>
                  onChange({ ...values, [request.requestId]: event.target.value })
                }
              >
                <NativeSelectOption value="">選択してください</NativeSelectOption>
                {request.options.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.name}
                  </NativeSelectOption>
                ))}
                {!request.required ? (
                  <NativeSelectOption value={OMIT_VALUE}>この要件を省略</NativeSelectOption>
                ) : null}
              </NativeSelect>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={
                    values[request.requestId] === OMIT_VALUE
                      ? ""
                      : (values[request.requestId] ?? "")
                  }
                  disabled={values[request.requestId] === OMIT_VALUE}
                  maxLength={2_000}
                  placeholder={
                    request.kind === "cta_url" ? "https://example.com/..." : "入力してください"
                  }
                  onChange={(event) =>
                    onChange({ ...values, [request.requestId]: event.target.value })
                  }
                />
                {!request.required ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onChange({
                        ...values,
                        [request.requestId]:
                          values[request.requestId] === OMIT_VALUE ? "" : OMIT_VALUE,
                      })
                    }
                  >
                    {values[request.requestId] === OMIT_VALUE ? "入力に戻す" : "省略"}
                  </Button>
                ) : null}
              </div>
            )}
            <FieldDescription>{request.reason}</FieldDescription>
          </Field>
        ))}
      </FieldGroup>
    </div>
  );
}
