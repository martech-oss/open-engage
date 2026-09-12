import { Archive, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorAlert as ErrorNotice } from "@/components/app-ui";
import { ArchiveConfirm } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ContactOptions } from "@/features/contacts/contact-api";
import { ContactSales } from "@/features/deals/contact-sales";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { ContactProfile } from "@openengage/core/contacts";

import { ContactAvatar, contactName, ContactStatusBadge } from "./contact-bits";
import { useContactDrawerController } from "./contact-drawer-controller";
import { ContactDrawerOverview } from "./contact-drawer-overview";
import { ContactDrawerRelations } from "./contact-drawer-relations";
import { ContactProfileForm } from "./contact-profile-form";
import { ContactScoreForm } from "./contact-score-form";
import { ContactTimelineTab } from "./contact-timeline-tab";

type ContactDrawerProps = {
  contactId: string;
  options: ContactOptions;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export function ContactDrawer(props: ContactDrawerProps): ReactNode {
  return <ContactDrawerContent key={props.contactId} {...props} />;
}

function ContactDrawerContent({ contactId, options, onClose, onChanged }: ContactDrawerProps) {
  const controller = useContactDrawerController(contactId, onChanged);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="!w-full overflow-hidden p-0 sm:!max-w-2xl">
        {controller.loading && !controller.profile ? (
          <DrawerSkeleton />
        ) : controller.profile ? (
          <Tabs
            value={controller.activeTab}
            onValueChange={(value) => controller.setActiveTab(value as "details" | "activity")}
            className="min-h-0 flex-1 gap-0"
          >
            <DrawerHeader
              profile={controller.profile}
              busy={controller.busy}
              onArchive={controller.archive}
              onRestore={controller.restore}
            />
            <TabsContent
              value="details"
              className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4"
            >
              {controller.error ? <ErrorNotice>{controller.error}</ErrorNotice> : null}
              <ContactDrawerOverview profile={controller.profile} />
              <ContactSales contactId={contactId} />
              <ContactProfileForm
                key={controller.profile.contact.id}
                profile={controller.profile}
                busy={controller.busy}
                onSave={controller.update}
              />
              <ContactDrawerRelations
                profile={controller.profile}
                options={options}
                busy={controller.busy}
                onAssignTag={controller.assignTag}
                onRemoveTag={controller.removeTag}
                onAddSegment={controller.addSegment}
                onRemoveSegment={controller.removeSegment}
                onAddCompany={controller.addCompany}
                onRemoveCompany={controller.removeCompany}
              />
              {controller.profile.contact.status !== "archived" ? (
                <ContactScoreForm busy={controller.busy} onSave={controller.adjustScore} />
              ) : null}
            </TabsContent>
            <TabsContent value="activity" className="min-h-0 overflow-y-auto p-4">
              {controller.error ? <ErrorNotice>{controller.error}</ErrorNotice> : null}
              <ContactTimelineTab profile={controller.profile} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="p-6">
            <ErrorNotice>
              {getErrorMessage(controller.loadError, "プロフィールを読み込めませんでした")}
            </ErrorNotice>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerHeader({
  profile,
  busy,
  onArchive,
  onRestore,
}: {
  profile: ContactProfile;
  busy: boolean;
  onArchive: () => Promise<boolean>;
  onRestore: () => Promise<boolean>;
}): ReactNode {
  const contact = profile.contact;
  return (
    <SheetHeader className="shrink-0 border-b bg-background p-4 pr-12">
      <div className="flex items-start gap-4">
        <ContactAvatar contact={contact} large />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="truncate text-lg">{contactName(contact)}</SheetTitle>
            <ContactStatusBadge status={contact.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {(profile.companies.find((company) => company.isPrimary) ?? profile.companies[0])
              ?.name ?? "会社未登録"}
          </p>
          <SheetDescription>{contact.email ?? contact.phone ?? "連絡先情報なし"}</SheetDescription>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-xs text-muted-foreground">スコア</span>
          <strong className="text-lg tabular-nums">{contact.score.toLocaleString()}</strong>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TabsList>
          <TabsTrigger value="activity">アクティビティ</TabsTrigger>
          <TabsTrigger value="details">プロフィール</TabsTrigger>
        </TabsList>
        {contact.status === "archived" ? (
          <Button
            variant="outline"
            className="ml-auto"
            disabled={busy}
            onClick={() => void onRestore()}
          >
            <RotateCcw data-icon="inline-start" />
            復元
          </Button>
        ) : (
          <ArchiveConfirm
            label={contactName(contact)}
            title="連絡先をアーカイブしますか？"
            description="配信対象から外れます。必要になった場合は後から復元できます。"
            trigger={<Button variant="destructive" className="ml-auto" disabled={busy} />}
            triggerContent={
              <>
                <Archive data-icon="inline-start" />
                アーカイブ
              </>
            }
            onConfirm={async () => {
              await onArchive();
            }}
          />
        )}
      </div>
    </SheetHeader>
  );
}

function DrawerSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-14 w-64" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
