import { Search, X } from "lucide-react";
import type { ReactNode } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  ASSET_KIND_LABELS,
  type AssetKind,
  type AssetSearch,
  type AssetStatusFilter,
  type AssetView,
} from "../asset-api";

export function AssetsToolbar({
  search,
  queryText,
  onQueryTextChange,
  onSearchChange,
}: {
  search: AssetSearch;
  queryText: string;
  onQueryTextChange: (value: string) => void;
  onSearchChange: (changes: Partial<AssetSearch>) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <InputGroup className="max-w-sm flex-1">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={queryText}
          onChange={(event) => onQueryTextChange(event.currentTarget.value)}
          placeholder="名前で検索"
          aria-label="アセットを検索"
        />
        {queryText ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={() => onQueryTextChange("")} aria-label="検索条件をクリア">
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <NativeSelect
        value={search.kind}
        onChange={(event) => onSearchChange({ kind: event.currentTarget.value as AssetKind | "" })}
        aria-label="種別で絞り込む"
        className="w-40"
      >
        <NativeSelectOption value="">すべての種別</NativeSelectOption>
        {(Object.keys(ASSET_KIND_LABELS) as AssetKind[]).map((kind) => (
          <NativeSelectOption key={kind} value={kind}>
            {ASSET_KIND_LABELS[kind]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <ToggleGroup
        value={[search.status]}
        onValueChange={(value) => {
          const next = value[0] as AssetStatusFilter | undefined;
          if (next) onSearchChange({ status: next });
        }}
        aria-label="表示する状態"
      >
        <ToggleGroupItem value="active">有効</ToggleGroupItem>
        <ToggleGroupItem value="archived">アーカイブ</ToggleGroupItem>
        <ToggleGroupItem value="all">すべて</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        value={[search.view]}
        onValueChange={(value) => {
          const next = value[0] as AssetView | undefined;
          if (next) onSearchChange({ view: next });
        }}
        aria-label="表示形式"
      >
        <ToggleGroupItem value="grid">ギャラリー</ToggleGroupItem>
        <ToggleGroupItem value="table">テーブル</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
