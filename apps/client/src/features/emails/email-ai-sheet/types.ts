import type { EmailGenerationProposal, EmailPurpose } from "@openengage/core/messaging";

export type EmailAiSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId?: string | undefined;
  mode: "create" | "refine";
  purpose: EmailPurpose;
  current: EmailGenerationProposal;
  onApply: (proposal: EmailGenerationProposal) => void;
};
