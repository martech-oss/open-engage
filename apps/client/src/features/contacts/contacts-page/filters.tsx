import type { ReactNode } from "react";

import { FormInput, FormNativeSelect } from "@/components/app-ui";
import { NativeSelectOption } from "@/components/ui/native-select";

import type { ContactOptions } from "../contact-api";
import type { ContactFilters } from "../contact-filters";

export function AdvancedContactFilters({
  filters,
  options,
}: {
  filters: ContactFilters;
  options: ContactOptions;
}): ReactNode {
  return (
    <div className="grid shrink-0 gap-3 border-b bg-secondary/50 p-3.5 md:grid-cols-2 xl:grid-cols-5">
      <FormNativeSelect
        label="ステージ"
        name="stage-filter"
        value={filters.stage}
        onChange={(event) => filters.setStage(event.target.value)}
      >
        <NativeSelectOption value="">すべて</NativeSelectOption>
        {options.stages.map((item) => (
          <NativeSelectOption key={item.stage} value={item.stage}>
            {item.stage} ({item.contactCount})
          </NativeSelectOption>
        ))}
      </FormNativeSelect>
      <FormNativeSelect
        label="タグ"
        name="tag-filter"
        value={filters.tagId}
        onChange={(event) => filters.setTagId(event.target.value)}
      >
        <NativeSelectOption value="">すべて</NativeSelectOption>
        {options.tags.map((tag) => (
          <NativeSelectOption key={tag.id} value={tag.id}>
            {tag.name}
          </NativeSelectOption>
        ))}
      </FormNativeSelect>
      <FormNativeSelect
        label="会社"
        name="company-filter"
        value={filters.companyId}
        onChange={(event) => filters.setCompanyId(event.target.value)}
      >
        <NativeSelectOption value="">すべて</NativeSelectOption>
        {options.companies.map((company) => (
          <NativeSelectOption key={company.id} value={company.id}>
            {company.name}
          </NativeSelectOption>
        ))}
      </FormNativeSelect>
      <FormInput
        label="スコア下限"
        name="scoreMin-filter"
        type="number"
        value={filters.scoreMin}
        onChange={(event) => filters.setScoreMin(event.target.value)}
      />
      <FormInput
        label="スコア上限"
        name="scoreMax-filter"
        type="number"
        value={filters.scoreMax}
        onChange={(event) => filters.setScoreMax(event.target.value)}
      />
    </div>
  );
}
