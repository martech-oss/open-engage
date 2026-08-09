import { BlocksIcon, CircleAlertIcon, CircleCheckIcon, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  compact = false,
  action,
  icon: Icon = BlocksIcon,
}: {
  title: string;
  description?: string;
  compact?: boolean;
  action?: ReactNode;
  icon?: LucideIcon;
}): ReactNode {
  return (
    <Empty className={cn(compact && "py-8", !compact && "min-h-56 border")}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function SimpleEmpty({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}): ReactNode {
  return <EmptyState title={label} compact={compact} />;
}

export function ErrorAlert({ children }: { children: ReactNode }): ReactNode {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>エラー</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function SuccessAlert({ children }: { children: ReactNode }): ReactNode {
  return (
    <Alert>
      <CircleCheckIcon />
      <AlertTitle>完了</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function LoadingButton({
  busy,
  busyLabel,
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button> & {
  busy: boolean;
  busyLabel?: string;
}): ReactNode {
  return (
    <Button aria-busy={busy} disabled={busy || disabled} {...props}>
      {busy ? <Spinner data-icon="inline-start" /> : null}
      {busy ? (busyLabel ?? "処理中…") : children}
    </Button>
  );
}
