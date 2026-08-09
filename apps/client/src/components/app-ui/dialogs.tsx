import { ArchiveIcon } from "lucide-react";
import type { FormEvent, ReactElement, ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";

import { ErrorAlert, LoadingButton } from "./feedback";

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className ?? "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  busy,
  error,
  submitLabel,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error?: string;
  submitLabel: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description !== undefined ? { description } : {})}
      {...(className !== undefined ? { className } : {})}
    >
      <form onSubmit={onSubmit}>
        <FieldGroup>
          {children}
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          <LoadingButton busy={busy} className="w-full" type="submit">
            {submitLabel}
          </LoadingButton>
        </FieldGroup>
      </form>
    </AppDialog>
  );
}

/** Generic destructive-action confirmation. `ArchiveConfirm`/`AssetDeleteConfirm` are thin presets of this. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "キャンセル",
  icon,
  triggerLabel,
  trigger,
  triggerContent,
  onConfirm,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  icon?: ReactElement;
  triggerLabel?: string;
  trigger?: ReactElement;
  triggerContent?: ReactNode;
  onConfirm: () => void | Promise<void>;
}): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          trigger ?? <Button size="sm" variant="ghost" aria-label={triggerLabel ?? confirmLabel} />
        }
      >
        {triggerContent ?? icon}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          {icon ? <AlertDialogMedia>{icon}</AlertDialogMedia> : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ArchiveConfirm({
  label,
  title = "アーカイブしますか？",
  description,
  confirmLabel = "アーカイブ",
  triggerLabel,
  trigger,
  triggerContent,
  onConfirm,
}: {
  label: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
  triggerLabel?: string;
  trigger?: ReactElement;
  triggerContent?: ReactNode;
  onConfirm: () => void | Promise<void>;
}): ReactNode {
  return (
    <ConfirmDialog
      title={title}
      description={description ?? `「${label}」を通常の一覧から非表示にします。`}
      confirmLabel={confirmLabel}
      icon={<ArchiveIcon />}
      triggerLabel={triggerLabel ?? `${label}をアーカイブ`}
      {...(trigger !== undefined ? { trigger } : {})}
      {...(triggerContent !== undefined ? { triggerContent } : {})}
      onConfirm={onConfirm}
    />
  );
}
