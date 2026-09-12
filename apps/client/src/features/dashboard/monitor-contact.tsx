import { useQuery } from "@tanstack/react-query";

import { ErrorAlert } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { contactOptionsQueryOptions } from "@/features/contacts/contact-api";
import { ContactDrawer } from "@/features/contacts/contact-drawer";

export function MonitorContact({
  contactId,
  onClose,
  onChanged,
}: {
  contactId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const query = useQuery(contactOptionsQueryOptions());
  if (query.data)
    return (
      <ContactDrawer
        contactId={contactId}
        options={query.data}
        onClose={onClose}
        onChanged={onChanged}
      />
    );
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>接点の連絡先</SheetTitle>
        </SheetHeader>
        <div className="p-4">
          {query.error ? (
            <>
              <ErrorAlert>連絡先を読み込めませんでした</ErrorAlert>
              <Button variant="outline" onClick={() => void query.refetch()}>
                再試行
              </Button>
            </>
          ) : (
            <output>連絡先を読み込んでいます…</output>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
