import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

import { routerOptions } from "@/router";
import { routeTree } from "@/routeTree.gen";

import "@/styles.css";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const router = createRouter({ ...routerOptions, routeTree, context: { queryClient } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
