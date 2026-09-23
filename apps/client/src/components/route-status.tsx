import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function RoutePending({ label = "画面を読み込んでいます…" }: { label?: string }): ReactNode {
  return (
    <output className="grid min-h-[50vh] place-items-center" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner />
        {label}
      </div>
    </output>
  );
}

export function RouteError({ error }: { error: Error }): ReactNode {
  const router = useRouter();
  return (
    <div className="grid min-h-[50vh] place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-xl font-semibold">画面を読み込めませんでした</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button variant="outline" onClick={() => void router.invalidate({ sync: true })}>
          再試行
        </Button>
      </div>
    </div>
  );
}
