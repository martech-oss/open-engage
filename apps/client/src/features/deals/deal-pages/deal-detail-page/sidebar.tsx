import { Archive } from "lucide-react";
import type { ReactNode } from "react";

import { ArchiveConfirm } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { DealDetailData } from "../../deal-api";
import { contactLabel } from "../../deal-labels";
import { DetailItem } from "../../deal-widgets";

export function DealSidebar({
  deal,
  onArchive,
}: {
  deal: DealDetailData["deal"];
  onArchive: () => Promise<void>;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>関連先</CardTitle>
          <CardDescription>この商談に紐づく顧客情報</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <DetailItem
            label="連絡先"
            value={contactLabel(deal) || "未設定"}
            detail={deal.contactEmail}
          />
          <DetailItem label="会社" value={deal.companyName ?? "未設定"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>メモ</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {deal.description || "商談の説明はまだありません。"}
          </p>
        </CardContent>
      </Card>
      <ArchiveConfirm
        label={deal.name}
        trigger={<Button variant="destructive" className="self-start" />}
        triggerContent={
          <>
            <Archive data-icon="inline-start" />
            アーカイブ
          </>
        }
        onConfirm={onArchive}
      />
    </div>
  );
}
