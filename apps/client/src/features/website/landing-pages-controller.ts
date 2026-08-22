import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { archiveWebsiteResource } from "./resource-model";
import {
  landingPagesQueryOptions,
  type LandingPageRow,
  useArchiveLandingPage,
  useCreateLandingPage,
  useUpdateLandingPage,
} from "./website-api";

export function useLandingPagesController() {
  const { data: items } = useSuspenseQuery(landingPagesQueryOptions());
  const editor = useResourceEditor<LandingPageRow>();
  const archiveMutation = useArchiveLandingPage();
  const createMutation = useCreateLandingPage();
  const updateMutation = useUpdateLandingPage();
  const archive = (item: LandingPageRow) =>
    archiveWebsiteResource({
      archive: () => archiveMutation.mutateAsync({ id: item.id }),
      onSuccess: () => toast.success("ランディングページをアーカイブしました"),
      onError: (message) => toast.error(message || "アーカイブできませんでした"),
    });
  return { items, editor, archive, createMutation, updateMutation };
}
