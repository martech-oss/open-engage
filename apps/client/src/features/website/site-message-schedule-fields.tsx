import type { ReactNode } from "react";

import { FormInput } from "@/components/app-ui";
import { FieldGroup } from "@/components/ui/field";

export function SiteMessageScheduleFields({
  startsAt,
  endsAt,
}: {
  startsAt: string;
  endsAt: string;
}): ReactNode {
  return (
    <FieldGroup className="grid gap-4 sm:grid-cols-2">
      <FormInput label="表示開始" name="startsAt" type="datetime-local" defaultValue={startsAt} />
      <FormInput label="表示終了" name="endsAt" type="datetime-local" defaultValue={endsAt} />
    </FieldGroup>
  );
}
