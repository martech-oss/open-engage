import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AutomationGenerationResult } from "@openengage/core/automations";

import { OMIT_VALUE } from "./resolutions";

export function ResourceResolutionForm({
  result,
  selections,
  onSelectionChange,
}: {
  result: Extract<AutomationGenerationResult, { status: "needs_input" }>;
  selections: Record<string, string>;
  onSelectionChange: (requestId: string, value: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Info />
        <AlertTitle>追加の選択が必要です</AlertTitle>
        <AlertDescription>{result.summary}</AlertDescription>
      </Alert>
      <ItemGroup>
        {result.plannedSteps.map((step, index) => (
          <Item key={`${index}-${step}`} variant="muted" size="sm">
            <ItemContent>
              <ItemTitle>ステップ {index + 1}</ItemTitle>
              <ItemDescription>{step}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      <FieldGroup>
        {result.resources.map((request) => {
          const items = [
            ...request.options.map((option) => ({ label: option.name, value: option.id })),
            ...(request.canOmit ? [{ label: "このステップを省略", value: OMIT_VALUE }] : []),
          ];
          return (
            <Field key={request.requestId} data-invalid={items.length === 0}>
              <FieldLabel>{request.label}</FieldLabel>
              <Select
                items={items}
                value={selections[request.requestId] || null}
                onValueChange={(value) => onSelectionChange(request.requestId, value ?? "")}
              >
                <SelectTrigger className="w-full" aria-invalid={items.length === 0}>
                  <SelectValue placeholder="候補を選択してください" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} side="bottom">
                  <SelectGroup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{request.reason}</FieldDescription>
              {items.length === 0 ? (
                <FieldError>
                  利用できる候補がありません。先に対象リソースを作成してください。
                </FieldError>
              ) : null}
            </Field>
          );
        })}
      </FieldGroup>
    </div>
  );
}
