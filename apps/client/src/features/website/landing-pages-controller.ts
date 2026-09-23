import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { websitePublicUrls } from "./public-urls";
import { archiveWebsiteResource } from "./resource-controller-actions";
import {
  landingPagesQueryOptions,
  type LandingPage,
  useArchiveLandingPage,
  useCreateLandingPage,
  useUpdateLandingPage,
} from "./website-api";

export function useLandingPagesController(workspaceSlug: string, publicOrigin?: string) {
  const { data: items } = useSuspenseQuery(landingPagesQueryOptions());
  const editor = useResourceEditor<LandingPage>();
  const archiveMutation = useArchiveLandingPage();
  const createMutation = useCreateLandingPage();
  const updateMutation = useUpdateLandingPage();
  const urls = websitePublicUrls(workspaceSlug, publicOrigin);
  const archive = (item: LandingPage) =>
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
    publicUrl: (item: LandingPage) => urls.landingPage(item.slug),
  };
}
