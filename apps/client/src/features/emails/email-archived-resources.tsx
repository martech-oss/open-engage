import type { ReactNode } from "react";

import { EmptyState } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailTemplateRow } from "@/features/emails/email-api";

export function ArchivedResources({
  templates,
  loading,
}: {
  templates: EmailTemplateRow[];
  loading: boolean;
}): ReactNode {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (templates.length === 0) {
    return (
      <EmptyState
        title="アーカイブは空です"
        description="使わなくなったテンプレートがここに表示されます。"
      />
    );
  }
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>テンプレート</CardTitle>
          <CardDescription>{templates.length}件</CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            {templates.map((template) => (
              <Item key={template.id} variant="outline">
                <ItemContent className="min-w-0">
                  <ItemTitle>{template.name}</ItemTitle>
                  <ItemDescription>{template.subject}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="secondary">{template.sendable ? "公開済み" : "下書き"}</Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>
    </div>
  );
}
