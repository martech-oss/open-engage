import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useResourceEditor } from "@/hooks/use-resource-editor";

import { websitePublicUrls } from "./public-urls";
import { archiveWebsiteResource } from "./resource-controller-actions";
import {
  signupFormsQueryOptions,
  type SignupFormRow,
  useArchiveSignupForm,
  useCreateSignupForm,
  useUpdateSignupForm,
} from "./website-api";

export function useSignupFormsController(workspaceSlug: string, publicOrigin?: string) {
  const { data: items } = useSuspenseQuery(signupFormsQueryOptions());
  const editor = useResourceEditor<SignupFormRow>();
  const archiveMutation = useArchiveSignupForm();
  const createMutation = useCreateSignupForm();
  const updateMutation = useUpdateSignupForm();
  const urls = websitePublicUrls(workspaceSlug, publicOrigin);
  const archive = (item: SignupFormRow) =>
    archiveWebsiteResource({
      archive: () => archiveMutation.mutateAsync({ id: item.id }),
      onSuccess: () => toast.success("サインアップフォームをアーカイブしました"),
      onError: (message) => toast.error(message || "アーカイブできませんでした"),
    });
  return {
    items,
    editor,
    archive,
    createMutation,
    updateMutation,
    publicUrls: (item: SignupFormRow) => ({
      page: urls.signupForm(item.slug),
      embed: urls.signupFormEmbed(item.slug),
    }),
  };
}
