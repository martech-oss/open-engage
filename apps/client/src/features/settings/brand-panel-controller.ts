import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { type EmailBrandProfile, useUpdateEmailBrandProfile } from "@/features/emails/email-api";
import { useFormSubmission } from "@/hooks/use-form-submission";

export function useBrandPanelController(initialProfile: EmailBrandProfile) {
  const updateBrand = useUpdateEmailBrandProfile();
  const submission = useFormSubmission("メールブランドを保存できませんでした");
  const [profile, setProfile] = useState(initialProfile);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submission.run(async () => {
      const saved = await updateBrand.mutateAsync({
        brandName: profile.brandName,
        companyDescription: profile.companyDescription,
        tone: profile.tone,
        logoAssetId: profile.logoAssetId,
        websiteUrl: profile.websiteUrl,
        primaryColor: profile.primaryColor,
        backgroundColor: profile.backgroundColor,
        textColor: profile.textColor,
        postalAddress: profile.postalAddress,
      });
      setProfile(saved);
      toast.success("メールブランドを保存しました");
    });
  }

  return { profile, setProfile, pickerOpen, setPickerOpen, submit, ...submission };
}
