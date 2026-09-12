import { EllipsisVertical, Plus, RefreshCw, Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ContactOptions, ContactSort, ContactStatus } from "@/features/contacts/contact-api";
import type { ContactFilters } from "@/features/contacts/contact-filters";
import { cn } from "@/lib/utils";

const SORT_OPTIONS = [
  { value: "updatedAt:desc", label: "更新順" },
  { value: "createdAt:desc", label: "作成順" },
  { value: "score:desc", label: "スコアが高い順" },
  { value: "score:asc", label: "スコアが低い順" },
  { value: "name:asc", label: "名前順" },
  { value: "email:asc", label: "メール順" },
];

/** Removable pill for one applied filter, tinted like the design's active-filter chip. */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }): ReactNode {
  return (
    <Badge variant="outline" className="shrink-0 gap-1 whitespace-nowrap">
      {label}
      <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label={`${label}を解除`}>
        <X />
      </Button>
    </Badge>
  );
}

/** Search conditions and result controls share the existing URL filter state. */
export function ContactsToolbar({
  filters,
  options,
  total,
  advancedOpen,
  onToggleAdvanced,
  onSaveSegment,
  canSaveSegment,
  onRefreshSegment,
  onExport,
  busy,
}: {
  filters: ContactFilters;
  options: ContactOptions;
  total: number;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  onSaveSegment: () => void;
  canSaveSegment: boolean;
  onRefreshSegment: () => void;
  onExport: () => void;
  busy: boolean;
}): ReactNode {
  const chips = activeChips(filters, options);
  const selectedSegment = options.segments.find((segment) => segment.id === filters.segmentId);

  return (
    <div className="shrink-0 border-b">
      <fieldset aria-label="連絡先の検索条件" className="flex flex-wrap items-center gap-2 p-3">
        <InputGroup className="h-10 w-full sm:w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="連絡先を検索"
            placeholder="名前、メール、電話番号で検索"
            className="text-sm"
            value={filters.query}
            onChange={(event) => filters.setQuery(event.target.value)}
          />
          {filters.query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => filters.setQuery("")}
                aria-label="検索をクリア"
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        <ToggleGroup
          value={[filters.status]}
          onValueChange={(values) => {
            const nextStatus = values[0] as ContactStatus | undefined;
            if (nextStatus) filters.setStatus(nextStatus);
          }}
          variant="outline"
          size="sm"
          spacing={0}
          className="shrink-0"
        >
          <ToggleGroupItem value="active">有効</ToggleGroupItem>
          <ToggleGroupItem value="all">すべて</ToggleGroupItem>
          <ToggleGroupItem value="archived">アーカイブ</ToggleGroupItem>
          <ToggleGroupItem value="anonymous">匿名</ToggleGroupItem>
        </ToggleGroup>

        <Button
          variant="outline"
          size="sm"
          className={cn("shrink-0", advancedOpen && "border-primary text-primary")}
          aria-expanded={advancedOpen}
          onClick={onToggleAdvanced}
        >
          <Plus data-icon="inline-start" />
          条件を追加
        </Button>
      </fieldset>
      {chips.length ? (
        <div aria-label="適用中の条件" className="flex flex-wrap gap-2 px-3 pb-3">
          {chips.map((chip) => (
            <FilterChip key={chip.label} label={chip.label} onRemove={chip.onRemove} />
          ))}
        </div>
      ) : null}
      <fieldset
        aria-label="検索結果と表示設定"
        className="flex flex-wrap items-center gap-3 border-t px-3 py-2"
      >
        <output className="mr-auto text-sm font-medium tabular-nums">
          {total.toLocaleString()}
          <span className="text-muted-foreground"> 件</span>
        </output>
        <Button
          variant="link"
          size="sm"
          className="h-10 px-2"
          disabled={!canSaveSegment}
          onClick={onSaveSegment}
        >
          セグメント保存
        </Button>
        <Select
          items={SORT_OPTIONS}
          value={`${filters.sort}:${filters.direction}`}
          onValueChange={(value) => {
            const [nextSort = "updatedAt", nextDirection = "desc"] = String(value).split(":");
            filters.setSort(nextSort as ContactSort);
            filters.setDirection(nextDirection === "asc" ? "asc" : "desc");
          }}
        >
          <SelectTrigger size="sm" className="h-10 min-w-0 text-sm" aria-label="並び順">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon-sm" aria-label="その他の操作" />}
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onExport}>CSVエクスポート</DropdownMenuItem>
              <DropdownMenuItem onClick={filters.clearFilters}>条件をクリア</DropdownMenuItem>
              {selectedSegment?.kind === "dynamic" ? (
                <DropdownMenuItem disabled={busy} onClick={onRefreshSegment}>
                  <RefreshCw />
                  セグメントを再評価
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </fieldset>
    </div>
  );
}

function activeChips(
  filters: ContactFilters,
  options: ContactOptions,
): Array<{ label: string; onRemove: () => void }> {
  const chips: Array<{ label: string; onRemove: () => void }> = [];
  const segment = options.segments.find((item) => item.id === filters.segmentId);
  if (segment) {
    chips.push({
      label: `${segment.kind === "static" ? "リスト" : "セグメント"}: ${segment.name}`,
      onRemove: () => filters.setSegmentId(""),
    });
  }
  const tag = options.tags.find((item) => item.id === filters.tagId);
  if (tag) chips.push({ label: `タグ: ${tag.name}`, onRemove: () => filters.setTagId("") });
  const company = options.companies.find((item) => item.id === filters.companyId);
  if (company) {
    chips.push({ label: `会社: ${company.name}`, onRemove: () => filters.setCompanyId("") });
  }
  if (filters.stage) {
    chips.push({ label: `ステージ: ${filters.stage}`, onRemove: () => filters.setStage("") });
  }
  if (filters.scoreMin || filters.scoreMax) {
    chips.push({
      label: `スコア: ${filters.scoreMin || "0"}〜${filters.scoreMax || "上限なし"}`,
      onRemove: () => {
        filters.setScoreMin("");
        filters.setScoreMax("");
      },
    });
  }
  return chips;
}

/**
 * Selection banner over the table. The design lists the bulk actions as plain
 * inline commands, so the tag/segment variants reveal their target picker in
 * place instead of hiding behind an action dropdown.
 */
export function BulkActionBar({
  count,
  children,
  onClear,
}: {
  count: number;
  children: ReactNode;
  onClear: () => void;
}): ReactNode {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-primary/15 bg-accent px-3 py-2">
      <output className="text-sm font-medium text-accent-foreground">
        {count.toLocaleString()}件を選択中
      </output>
      <span aria-hidden="true" className="h-4 w-px bg-primary/20" />
      {children}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        選択解除
      </Button>
    </div>
  );
}
