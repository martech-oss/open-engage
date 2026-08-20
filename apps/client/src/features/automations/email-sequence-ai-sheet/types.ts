import type { ApplyEmailSequenceResult } from "@openengage/core/automations";
import type { ProjectBriefReference } from "@openengage/core/projects";

export type EmailSequenceAiSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (result: ApplyEmailSequenceResult) => Promise<void>;
  entityId?: string;
} & ProjectBriefReference;
