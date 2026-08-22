import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { websitePublicUrls } from "./public-urls";
import { archiveWebsiteResource } from "./resource-controller-actions";
import {
  landingPagesQueryOptions,
  type LandingPageRow,
  useArchiveLandingPage,
  useCreateLandingPage,
  useUpdateLandingPage,
} from "./website-api";

export function useLandingPagesController(workspaceSlug: string, publicOrigin?: string) {
  const { data: items } = useSuspenseQuery(landingPagesQueryOptions());
  const editor = useResourceEditor<LandingPageRow>();
  const archiveMutation = useArchiveLandingPage();
  const createMutation = useCreateLandingPage();
  const updateMutation = useUpdateLandingPage();
  const urls = websitePublicUrls(workspaceSlug, publicOrigin);
  const archive = (item: LandingPageRow) =>
    archiveWebsiteResource({
      archive: () => archiveMutation.mutateAsync({ id: item.id }),
      onSuccess: () => toast.success("ランディングページをアーカイブしました"),
      onError: (message) => toast.error(message || "アーカイブできませんでした"),
    });
  return {
    items,
    editor,
    archive,
    createMutation,
    updateMutation,
    publicUrl: (item: LandingPageRow) => urls.landingPage(item.slug),
  };
}
