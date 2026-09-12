import { createRootRoute, Outlet } from "@tanstack/react-router";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
export const Route = createRootRoute({
  beforeLoad: () => ({ renderedAt: "2026-09-12T06:00:00Z" }),
  component: () => (
    <TooltipProvider>
      <Outlet />
      <p
        style={{
          position: "fixed",
          bottom: 4,
          right: 12,
          zIndex: 40,
          fontSize: 11,
          padding: "2px 8px",
          background: "#fff",
          color: "#485360",
          border: "1px solid #e1e5eb",
          borderRadius: 4,
          pointerEvents: "none",
        }}
      >
        サンプルデータ · 保存・公開は無効
      </p>
      <Toaster />
    </TooltipProvider>
  ),
});
