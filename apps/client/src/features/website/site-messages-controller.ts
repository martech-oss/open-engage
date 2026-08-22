import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { archiveWebsiteResource } from "./resource-controller-actions";
import {
  siteMessagesQueryOptions,
  type SiteMessageRow,
  useArchiveSiteMessage,
  useCreateSiteMessage,
  useUpdateSiteMessage,
} from "./website-api";

export function useSiteMessagesController() {
  const { data: items } = useSuspenseQuery(siteMessagesQueryOptions());
  const editor = useResourceEditor<SiteMessageRow>();
  const archiveMutation = useArchiveSiteMessage();
  const createMutation = useCreateSiteMessage();
  const updateMutation = useUpdateSiteMessage();
  const archive = (item: SiteMessageRow) =>
    archiveWebsiteResource({
      archive: () => archiveMutation.mutateAsync({ id: item.id }),
      onSuccess: () => toast.success("サイトメッセージをアーカイブしました"),
      onError: (message) => toast.error(message || "アーカイブできませんでした"),
    });
  return { items, editor, archive, createMutation, updateMutation };
}
