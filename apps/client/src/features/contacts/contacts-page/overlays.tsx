import type { ComponentProps, ReactNode } from "react";

import type { ContactOptions } from "../contact-api";
import { ContactDrawer } from "../contact-drawer";
import { ContactCreateForm, SegmentSaveForm } from "../contact-forms";

export function ContactOverlays({
  options,
  showCreate,
  onShowCreateChange,
  showSegmentSave,
  onShowSegmentSaveChange,
  segmentFilter,
  activeContactId,
  onCloseContact,
  onContactDataChanged,
  onOptionsChanged,
}: {
  options: ContactOptions;
  showCreate: boolean;
  onShowCreateChange: (open: boolean) => void;
  showSegmentSave: boolean;
  onShowSegmentSaveChange: (open: boolean) => void;
  segmentFilter: ComponentProps<typeof SegmentSaveForm>["filter"];
  activeContactId: string | null;
  onCloseContact: () => void;
  onContactDataChanged: () => Promise<void>;
  onOptionsChanged: () => Promise<void>;
}): ReactNode {
  return (
    <>
      <ContactCreateForm
        open={showCreate}
        onOpenChange={onShowCreateChange}
        options={options}
        onSaved={async () => {
          onShowCreateChange(false);
          await onContactDataChanged();
        }}
      />
      <SegmentSaveForm
        open={showSegmentSave}
        onOpenChange={onShowSegmentSaveChange}
        filter={segmentFilter}
        onSaved={async () => {
          onShowSegmentSaveChange(false);
          await onOptionsChanged();
        }}
      />
      {activeContactId ? (
        <ContactDrawer
          contactId={activeContactId}
          options={options}
          onClose={onCloseContact}
          onChanged={onContactDataChanged}
        />
      ) : null}
    </>
  );
}
