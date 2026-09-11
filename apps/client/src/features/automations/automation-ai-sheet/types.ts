import type { AutomationDefinition } from "@openengage/core/automations";
import type { ProjectBriefReference } from "@openengage/core/projects";

export type AutomationAiSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "refine";
  currentDefinition?: AutomationDefinition;
  entityId?: string;
  onApply: (definition: AutomationDefinition) => Promise<void>;
} & ProjectBriefReference;
