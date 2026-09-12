import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The app-wide page header: title and page actions.
 * Section sub-navigation lives at the top of the work surface.
 */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }): ReactNode {
  return (
    <header className="shrink-0 border-b bg-card px-4 py-2 md:px-6">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="font-heading text-2xl leading-tight font-semibold wrap-anywhere">
            {title}
          </h1>
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
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title={title} action={action} />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-4 px-4 md:px-6",
          fill ? "min-h-0 overflow-hidden pt-4 pb-4" : "overflow-y-auto py-4 [&>*]:shrink-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
