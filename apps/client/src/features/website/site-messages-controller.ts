import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { archiveWebsiteResource } from "./resource-controller-actions";
import {
  siteMessagesQueryOptions,
  type SiteMessage,
  useArchiveSiteMessage,
  useCreateSiteMessage,
  useUpdateSiteMessage,
} from "./website-api";

export function useSiteMessagesController() {
  const { data: items } = useSuspenseQuery(siteMessagesQueryOptions());
  const editor = useResourceEditor<SiteMessage>();
  const archiveMutation = useArchiveSiteMessage();
  const createMutation = useCreateSiteMessage();
  const updateMutation = useUpdateSiteMessage();
  const archive = (item: SiteMessage) =>
    archiveWebsiteResource({
      archive: () => archiveMutation.mutateAsync({ id: item.id }),
      onSuccess: () => toast.success("サイトメッセージをアーカイブしました"),
      onError: (message) => toast.error(message || "アーカイブできませんでした"),
    });
  return { items, editor, archive, createMutation, updateMutation };
}
