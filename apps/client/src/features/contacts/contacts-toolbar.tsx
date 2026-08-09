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

/**
 * The filters, result count and list controls the design collapses into a single
 * toolbar strip above the table. Everything that used to live in the card
 * header — search, status, resource pickers, sort — reads from and writes to the
 * same `useContactFilters` state, so the URL stays the single source of truth.
 */
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
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
      <InputGroup className="h-8 w-56 shrink-0">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="名前、メール、電話番号で検索"
          className="text-xs"
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

      {chips.map((chip) => (
        <FilterChip key={chip.label} label={chip.label} onRemove={chip.onRemove} />
      ))}

      <Button
        variant="outline"
        size="sm"
        className={cn("shrink-0", advancedOpen && "border-primary text-primary")}
        onClick={onToggleAdvanced}
      >
        <Plus data-icon="inline-start" />
        条件を追加
      </Button>

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <span className="text-xs font-medium tabular-nums">
          {total.toLocaleString()}
          <span className="text-muted-foreground"> 件</span>
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-7 px-0"
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
          <SelectTrigger size="sm" className="h-8 min-w-0 text-xs" aria-label="並び順">
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
              {selectedSegment ? (
                <DropdownMenuItem disabled={busy} onClick={onRefreshSegment}>
                  <RefreshCw />
                  セグメントを再評価
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
    chips.push({ label: `セグメント: ${segment.name}`, onRemove: () => filters.setSegmentId("") });
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
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-primary/15 bg-accent px-3.5 py-2">
      <span className="text-xs font-medium text-accent-foreground">
        {count.toLocaleString()}件を選択中
      </span>
      <span className="h-3.5 w-px bg-primary/20" />
      {children}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        選択解除
      </Button>
    </div>
  );
}
