import type { AssetSummary } from "../asset-api";

export type AssetPagination = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNext: () => void;
  onPrevious: () => void;
};

export type AssetActionHandlers = {
  onEdit: (asset: AssetSummary) => void;
  onReplace: (asset: AssetSummary) => void;
  onRestore: (asset: AssetSummary) => void;
  onArchive: (asset: AssetSummary) => Promise<void>;
  onDelete: (asset: AssetSummary) => Promise<void>;
};
