import { Info, Sparkles, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import type {
  AutomationDefinition,
  AutomationGenerationResult,
} from "@openengage/core/automations";

import { nodeLabel, nodeTypeLabel } from "../automation-labels";
import { definitionDiff } from "./definition-diff";

export function ReadyProposal({
  result,
  currentDefinition,
}: {
  result: Extract<AutomationGenerationResult, { status: "ready" }>;
  currentDefinition: AutomationDefinition | undefined;
}): ReactNode {
  const diff = useMemo(
    () => (currentDefinition ? definitionDiff(currentDefinition, result.definition) : null),
    [currentDefinition, result.definition],
  );
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Sparkles />
        <AlertTitle>{result.definition.name}</AlertTitle>
        <AlertDescription>{result.summary}</AlertDescription>
      </Alert>
      {diff ? (
        <div className="flex flex-wrap gap-2" aria-label="変更内容">
          <Badge variant="secondary">追加 {diff.added}</Badge>
          <Badge variant="secondary">変更 {diff.changed}</Badge>
          <Badge variant="secondary">削除 {diff.removed}</Badge>
        </div>
      ) : null}
      <ItemGroup>
        {result.definition.nodes.map((node, index) => (
          <Item key={node.id} variant="outline" size="sm">
            <Badge variant="secondary">{index + 1}</Badge>
            <ItemContent>
              <ItemTitle>{nodeLabel(node)}</ItemTitle>
              <ItemDescription>{nodeTypeLabel(node.type)}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      {result.assumptions.length > 0 ? (
        <Alert>
          <Info />
          <AlertTitle>AIが置いた前提</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {result.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {result.warnings.length > 0 ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>確認事項</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
