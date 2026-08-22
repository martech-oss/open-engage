import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "@xyflow/react/dist/style.css";
import "../styles.css";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: () => ({ renderedAt: new Date().toISOString() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#07130f" },
      { title: "OpenEngage" },
    ],
  }),
  component: RootComponent,
});

function RootComponent(): ReactNode {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          <Outlet />
          <Toaster position="top-right" richColors />
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
