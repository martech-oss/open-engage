import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Building2,
  Check,
  Filter,
  RotateCcw,
  Tag,
  Tags,
  UserRound,
  Zap,
} from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import {
  ArchiveConfirm,
  ErrorAlert as ErrorNotice,
  FormInput,
  LoadingButton,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addContactToSegment,
  adjustContactScore,
  archiveContact,
  assignContactTag,
  contactProfileQueryOptions,
  invalidateContactOptions,
  removeContactFromSegment,
  removeContactTag,
  restoreContact,
  type ContactOptions,
  updateContact,
} from "@/features/contacts/contact-api";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString, nullableString } from "@/lib/form-data";
import { formatLongDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type ContactProfile } from "@openengage/core/contacts";

import { ContactAvatar, contactName, ContactStatusBadge, Section, StatCard } from "./contact-bits";
import { CompanyEditor, RelationEditor, SegmentEditor } from "./contact-editors";

export function ContactDrawer({
  contactId,
  options,
  onClose,
  onChanged,
}: {
  contactId: string;
  options: ContactOptions;
  onClose: () => void;
  onChanged: () => Promise<void>;
}): ReactNode {
  const profileQuery = useQuery(contactProfileQueryOptions(contactId));
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "activity">("details");

  const profile = profileQuery.data;
  const loading = profileQuery.isLoading;

  async function changed() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: contactProfileQueryOptions(contactId).queryKey }),
      invalidateContactOptions(queryClient),
      onChanged(),
    ]);
  }

  async function mutate(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await changed();
    } catch (caught) {
      setError(getErrorMessage(caught, "更新できませんでした"));
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="!w-full overflow-y-auto p-0 sm:!max-w-2xl">
        {loading && !profile ? (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-14 w-64" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : profile ? (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "details" | "activity")}
            className="gap-0"
          >
            <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start gap-4">
                <ContactAvatar contact={profile.contact} large />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-xl">
                      {contactName(profile.contact)}
                    </SheetTitle>
                    <ContactStatusBadge status={profile.contact.status} />
                  </div>
                  <SheetDescription>
                    {profile.contact.email ?? profile.contact.phone ?? "連絡先情報なし"}
                  </SheetDescription>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <TabsList>
                  <TabsTrigger value="details">プロフィール</TabsTrigger>
                  <TabsTrigger value="activity">アクティビティ</TabsTrigger>
                </TabsList>
                {profile.contact.status === "archived" ? (
                  <Button
                    variant="outline"
                    className="ml-auto"
                    onClick={() => void mutate(() => restoreContact(contactId))}
                  >
                    <RotateCcw data-icon="inline-start" />
                    復元
                  </Button>
                ) : (
                  <ArchiveConfirm
                    label={contactName(profile.contact)}
                    title="連絡先をアーカイブしますか？"
                    description="配信対象から外れます。必要になった場合は後から復元できます。"
                    trigger={<Button variant="destructive" className="ml-auto" />}
                    triggerContent={
                      <>
                        <Archive data-icon="inline-start" />
                        アーカイブ
                      </>
                    }
                    onConfirm={() => mutate(() => archiveContact(contactId))}
                  />
                )}
              </div>
            </SheetHeader>

            <TabsContent value="details" className="flex flex-col gap-5 p-6">
              {error && <ErrorNotice>{error}</ErrorNotice>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="スコア" value={profile.contact.score} icon={<Zap />} />
                <StatCard label="タグ" value={profile.tags.length} icon={<Tag />} />
                <StatCard label="所属" value={profile.segments.length} icon={<Filter />} />
                <StatCard label="会社" value={profile.companies.length} icon={<Building2 />} />
              </div>

              <ProfileEditForm
                profile={profile}
                disabled={profile.contact.status === "archived"}
                onSaved={changed}
              />

              <RelationEditor
                title="タグ"
                icon={<Tags className="size-4" />}
                items={profile.tags}
                options={options.tags}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) => mutate(() => assignContactTag(contactId, id))}
                onRemove={(id) => mutate(() => removeContactTag(contactId, id))}
              />

              <CompanyEditor
                contactId={contactId}
                companies={profile.companies}
                options={options.companies}
                disabled={profile.contact.status === "archived"}
                onChanged={changed}
              />

              <SegmentEditor
                profile={profile}
                options={options.segments}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) => mutate(() => addContactToSegment(contactId, id))}
                onRemove={(id) => mutate(() => removeContactFromSegment(contactId, id))}
              />

              <ScoreForm
                contactId={contactId}
                disabled={profile.contact.status === "archived"}
                onSaved={changed}
              />
            </TabsContent>
            <TabsContent value="activity" className="p-6">
              {error && <ErrorNotice>{error}</ErrorNotice>}
              <ActivityTimeline profile={profile} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="p-6">
            <ErrorNotice>
              {getErrorMessage(profileQuery.error, "プロフィールを読み込めませんでした")}
            </ErrorNotice>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProfileEditForm({
  profile,
  disabled,
  onSaved,
}: {
  profile: ContactProfile;
  disabled: boolean;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const contact = profile.contact;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await updateContact(contact.id, {
        firstName: nullableString(form.get("firstName")),
        lastName: nullableString(form.get("lastName")),
        email: nullableString(form.get("email")),
        phone: nullableString(form.get("phone")),
        externalId: nullableString(form.get("externalId")),
        stage: getFormString(form, "stage"),
      });
      await onSaved();
    });
  }
  return (
    <Section title="基本情報" icon={<UserRound className="size-4" />}>
      <form onSubmit={(event) => void submit(event)}>
        <FieldGroup>
          <FieldGroup className="grid grid-cols-2 gap-3">
            <FormInput
              label="名"
              name="firstName"
              defaultValue={contact.firstName ?? ""}
              disabled={disabled}
            />
            <FormInput
              label="姓"
              name="lastName"
              defaultValue={contact.lastName ?? ""}
              disabled={disabled}
            />
          </FieldGroup>
          <FormInput
            label="メール"
            name="email"
            type="email"
            defaultValue={contact.email ?? ""}
            disabled={disabled}
          />
          <FieldGroup className="grid grid-cols-2 gap-3">
            <FormInput
              label="電話番号"
              name="phone"
              defaultValue={contact.phone ?? ""}
              disabled={disabled}
            />
            <FormInput
              label="外部ID"
              name="externalId"
              defaultValue={contact.externalId ?? ""}
              disabled={disabled}
            />
          </FieldGroup>
          <FormInput
            label="ステージ"
            name="stage"
            defaultValue={contact.stage}
            disabled={disabled}
            required
          />
          {error && <ErrorNotice>{error}</ErrorNotice>}
          {!disabled && (
            <LoadingButton busy={busy} variant="outline" type="submit">
              <Check data-icon="inline-start" />
              基本情報を保存
            </LoadingButton>
          )}
        </FieldGroup>
      </form>
    </Section>
  );
}

function ScoreForm({
  contactId,
  disabled,
  onSaved,
}: {
  contactId: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("スコアを変更できませんでした");
  if (disabled) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      await adjustContactScore(contactId, {
        delta: Number(form.get("delta")),
        reason: getFormString(form, "reason"),
      });
      formElement.reset();
      await onSaved();
    });
  }
  return (
    <Section title="スコアを調整" icon={<Zap className="size-4" />}>
      <form onSubmit={(event) => void submit(event)}>
        <FieldGroup className="grid gap-3 md:grid-cols-[120px_1fr_auto]">
          <FormInput label="加減点" name="delta" type="number" required />
          <FormInput label="理由" name="reason" required />
          <div className="flex items-end">
            <LoadingButton busy={busy} variant="outline" type="submit">
              反映
            </LoadingButton>
          </div>
          {error && (
            <div className="md:col-span-3">
              <ErrorNotice>{error}</ErrorNotice>
            </div>
          )}
        </FieldGroup>
      </form>
    </Section>
  );
}

function ActivityTimeline({ profile }: { profile: ContactProfile }): ReactNode {
  const entries = useMemo(
    () =>
      [
        ...profile.timeline.map((event) => ({
          id: event.id,
          type: event.type,
          description: event.resourceType
            ? `${event.resourceType}${event.resourceId ? ` · ${event.resourceId}` : ""}`
            : "Contact activity",
          at: event.occurredAt,
          tone: "indigo",
        })),
        ...profile.scoreEvents.map((event) => ({
          id: event.id,
          type: event.delta > 0 ? `スコア +${event.delta}` : `スコア ${event.delta}`,
          description: event.reason,
          at: event.createdAt,
          tone: event.delta > 0 ? "emerald" : "amber",
        })),
      ].sort((left, right) => right.at.localeCompare(left.at)),
    [profile.scoreEvents, profile.timeline],
  );
  return (
    <Section title="アクティビティ" icon={<Zap className="size-4" />}>
      <div className="flex flex-col">
        {entries.map((entry) => (
          <div key={`${entry.type}-${entry.id}`} className="flex gap-3 border-b py-3 last:border-0">
            <span
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                entry.tone === "emerald"
                  ? "bg-success"
                  : entry.tone === "amber"
                    ? "bg-warning"
                    : "bg-primary",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{entry.type}</div>
              <div className="truncate text-xs text-muted-foreground">{entry.description}</div>
            </div>
            <time className="shrink-0 text-xs text-muted-foreground">
              {formatLongDateTime(entry.at)}
            </time>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            まだアクティビティがありません
          </div>
        )}
      </div>
    </Section>
  );
}
