import { useState } from "react";
import { toast } from "sonner";

/**
 * The create/edit-dialog state every resource list page in this app needed by
 * hand: which row (if any) is being edited, whether the dialog is open, and
 * the open-for-create/open-for-edit/close handlers around it.
 */
export function useResourceEditor<Row>() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  function openCreate(): void {
    setSessionKey((current) => current + 1);
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(row: Row): void {
    setSessionKey((current) => current + 1);
    setEditing(row);
    setDialogOpen(true);
  }

  function close(): void {
    setDialogOpen(false);
    setEditing(null);
  }

  return {
    dialogOpen,
    editing,
    sessionKey,
    openCreate,
    openEdit,
    close,
    onOpenChange: setDialogOpen,
  };
}

/**
 * The create-or-update dispatch every resource editor dialog in this app
 * needed by hand: call update when editing an existing row, create otherwise,
 * toast the right message, then let the caller close the dialog / refresh.
 */
export async function saveResource<Payload>({
  editing,
  payload,
  create,
  update,
  createdMessage,
  updatedMessage,
  onSaved,
}: {
  editing: { id: string } | null;
  payload: Payload;
  create: (payload: Payload) => Promise<unknown>;
  update: (id: string, payload: Payload) => Promise<unknown>;
  createdMessage: string;
  updatedMessage: string;
  onSaved: () => void;
}): Promise<void> {
  await (editing ? update(editing.id, payload) : create(payload));
  toast.success(editing ? updatedMessage : createdMessage);
  onSaved();
}
