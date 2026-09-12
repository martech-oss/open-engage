import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "@/routeTree.gen";

import "@/styles.css";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const router = createRouter({ routeTree, context: { queryClient }, scrollRestoration: true });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
