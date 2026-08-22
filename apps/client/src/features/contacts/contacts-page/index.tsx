import { Download, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorAlert as ErrorNotice, PageLayout as Page } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import type { ContactSearch } from "../contact-api";
import { ContactsToolbar } from "../contacts-toolbar";
import { ContactBulkActions } from "./bulk-actions";
import { useContactsPageController } from "./controller";
import { AdvancedContactFilters } from "./filters";
import { ContactOverlays } from "./overlays";
import { ContactsTable } from "./table";

export function ContactsPage({
  initialSearch,
  renderedAt = "1970-01-01T00:00:00.000Z",
}: {
  initialSearch: ContactSearch;
  renderedAt?: string;
}): ReactNode {
  const controller = useContactsPageController(initialSearch, renderedAt);
  return (
    <Page
      title="連絡先"
      fill
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={controller.exportContacts}>
            <Download data-icon="inline-start" />
            エクスポート
          </Button>
          <Button size="sm" onClick={() => controller.setShowCreate(true)}>
            <Plus data-icon="inline-start" />
            連絡先を追加
          </Button>
        </div>
      }
    >
      <Card className="min-h-0 flex-1 gap-0 py-0">
        <ContactsToolbar
          filters={controller.filters}
          options={controller.options}
          total={controller.total}
          advancedOpen={controller.advancedOpen}
          onToggleAdvanced={controller.toggleAdvanced}
          onSaveSegment={() => controller.setShowSegmentSave(true)}
          canSaveSegment={Boolean(controller.segmentFilter) && !controller.filters.segmentId}
          onRefreshSegment={controller.refreshSegment}
          onExport={controller.exportContacts}
          busy={controller.busy}
        />
        {controller.advancedOpen ? (
          <AdvancedContactFilters filters={controller.filters} options={controller.options} />
        ) : null}
        <ContactBulkActions
          count={controller.selected.size}
          options={controller.options}
          activeAction={controller.bulkAction}
          resourceId={controller.bulkResourceId}
          busy={controller.busy}
          onClear={() => controller.setSelected(new Set())}
          onChooseAction={controller.chooseBulkAction}
          onResourceChange={controller.setBulkResourceId}
          onApply={controller.runSelectedBulkAction}
        />
        {controller.loadError ? (
          <div className="shrink-0 border-b p-3.5">
            <ErrorNotice>{controller.loadError}</ErrorNotice>
          </div>
        ) : null}
        <ContactsTable
          contacts={controller.contacts}
          columns={controller.columns}
          loading={controller.loading}
          pagination={controller.pagination}
          onOpen={controller.setActiveContactId}
        />
      </Card>
      <ContactOverlays
        options={controller.options}
        showCreate={controller.showCreate}
        onShowCreateChange={controller.setShowCreate}
        showSegmentSave={controller.showSegmentSave}
        onShowSegmentSaveChange={controller.setShowSegmentSave}
        segmentFilter={controller.segmentFilter}
        activeContactId={controller.activeContactId}
        onCloseContact={() => controller.setActiveContactId(null)}
        onContactDataChanged={controller.refreshContactData}
        onOptionsChanged={controller.refreshOptions}
      />
    </Page>
  );
}
