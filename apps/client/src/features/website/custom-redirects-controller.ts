import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { websitePublicUrls } from "./public-urls";
import { archiveWebsiteResource } from "./resource-controller-actions";
import {
  customRedirectsQueryOptions,
  siteTrackingQueryOptions,
  type CustomRedirectRow,
  useArchiveCustomRedirect,
  useCreateCustomRedirect,
  useUpdateCustomRedirect,
} from "./website-api";

export function useCustomRedirectsController(publicOrigin?: string) {
  const { data: items } = useSuspenseQuery(customRedirectsQueryOptions());
  const { data: tracking } = useSuspenseQuery(siteTrackingQueryOptions());
  const editor = useResourceEditor<CustomRedirectRow>();
  const archiveMutation = useArchiveCustomRedirect();
  const createMutation = useCreateCustomRedirect();
  const updateMutation = useUpdateCustomRedirect();
  const urls = websitePublicUrls(tracking.workspaceSlug, publicOrigin);
  const archive = (item: CustomRedirectRow) =>
    archiveWebsiteResource({
      archive: () => archiveMutation.mutateAsync({ id: item.id }),
      onSuccess: () => toast.success("リンクをアーカイブしました"),
      onError: (message) => toast.error(message || "アーカイブできませんでした"),
    });
  return {
    items,
    editor,
    archive,
    createMutation,
    updateMutation,
    publicUrl: (item: CustomRedirectRow) => urls.customRedirect(item.slug),
  };
}
