import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { archiveWebsiteResource } from "./resource-model";
import {
  customRedirectsQueryOptions,
  siteTrackingQueryOptions,
  type CustomRedirectRow,
  useArchiveCustomRedirect,
  useCreateCustomRedirect,
  useUpdateCustomRedirect,
} from "./website-api";

export function useCustomRedirectsController() {
  const { data: items } = useSuspenseQuery(customRedirectsQueryOptions());
  const { data: tracking } = useSuspenseQuery(siteTrackingQueryOptions());
  const editor = useResourceEditor<CustomRedirectRow>();
  const archiveMutation = useArchiveCustomRedirect();
  const createMutation = useCreateCustomRedirect();
  const updateMutation = useUpdateCustomRedirect();
  const archive = (item: CustomRedirectRow) =>
    archiveWebsiteResource({
      archive: () => archiveMutation.mutateAsync({ id: item.id }),
      onSuccess: () => toast.success("リンクをアーカイブしました"),
      onError: (message) => toast.error(message || "アーカイブできませんでした"),
    });
  return {
    items,
    workspaceSlug: tracking.workspaceSlug,
    editor,
    archive,
    createMutation,
    updateMutation,
  };
}
