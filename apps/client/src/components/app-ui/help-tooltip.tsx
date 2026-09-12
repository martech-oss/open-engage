import { CircleHelp } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Contextual help stays out of the reading flow until requested. */
export function HelpTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        type="button"
        aria-label={`${label}の説明`}
        aria-describedby={open ? contentId : undefined}
        closeOnClick={false}
        onClick={() => setOpen(true)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent
        id={contentId}
        role="tooltip"
        className="max-w-[min(24rem,calc(100vw-2rem))] leading-relaxed font-normal"
      >
        <div>{children}</div>
      </TooltipContent>
    </Tooltip>
  );
}
