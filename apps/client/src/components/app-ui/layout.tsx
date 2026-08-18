import type { ReactNode } from "react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * The app-wide page header: title and page actions.
 * Section sub-navigation lives in the sidebar under the active item.
 */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }): ReactNode {
  return (
    <header className="shrink-0 border-b bg-card px-6 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <SidebarTrigger className="md:hidden" aria-label="ナビゲーションを開く" />
          <h1 className="truncate font-heading text-[19px] leading-tight font-bold">{title}</h1>
        </div>
        {action}
      </div>
    </header>
  );
}

/**
 * Page scaffold: a fixed header over a scrolling content column.
 *
 * `fill` hands the full remaining height to the children instead of letting the
 * column scroll — for list screens whose table body scrolls on its own under a
 * pinned toolbar and pagination footer.
 */
export function PageLayout({
  title,
  action,
  fill = false,
  children,
}: {
  title: string;
  action?: ReactNode;
  fill?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={title} action={action} />
      <div
        className={cn(
          "flex flex-1 flex-col gap-4 px-6",
          fill ? "min-h-0 overflow-hidden pt-3.5" : "overflow-y-auto py-4.5",
        )}
      >
        {children}
      </div>
    </div>
  );
}
