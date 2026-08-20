import { Info, Sparkles, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { EmailSequenceProposal } from "@openengage/core/automations";

import { nodeLabel, nodeTypeLabel } from "../automation-labels";

export function ReadySequence({
  proposal,
  previews,
  selectedEmailRef,
  onSelectEmail,
  onChooseSubject,
}: {
  proposal: EmailSequenceProposal;
  previews: Record<string, string>;
  selectedEmailRef: string;
  onSelectEmail: (emailRef: string) => void;
  onChooseSubject: (emailRef: string, subject: string) => void;
}): ReactNode {
  const selected = proposal.emails.find((email) => email.emailRef === selectedEmailRef);
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Sparkles />
        <AlertTitle>{proposal.overview.name}</AlertTitle>
        <AlertDescription>{proposal.summary}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{proposal.overview.type.replaceAll("_", " ")}</Badge>
        <Badge
          variant={
            proposal.capabilityState === "transactional-compatible" ? "secondary" : "outline"
          }
        >
          {proposal.capabilityState === "transactional-compatible"
            ? "Transactional互換"
            : "Marketing送信は未提供"}
        </Badge>
        <Badge variant="outline">{proposal.emails.length}通</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">シーケンス設計</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Summary label="対象" value={proposal.overview.audience} />
          <Summary label="開始" value={proposal.overview.entry} />
          <Summary label="目的" value={proposal.overview.outcome} />
          <Summary label="終了" value={proposal.overview.conversionExit} />
          <Summary label="間隔" value={proposal.overview.cadence} />
          <Summary label="再参加" value={proposal.overview.reentry} />
        </CardContent>
      </Card>

      <Field>
        <FieldLabel>確認するメール</FieldLabel>
        <NativeSelect
          value={selectedEmailRef}
          onChange={(event) => onSelectEmail(event.target.value)}
        >
          {proposal.emails.map((email, index) => (
            <NativeSelectOption key={email.emailRef} value={email.emailRef}>
              {index + 1}. {email.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selected.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field>
              <FieldLabel>件名</FieldLabel>
              <NativeSelect
                value={selected.selectedSubject}
                onChange={(event) => onChooseSubject(selected.emailRef, event.target.value)}
              >
                {selected.subjectOptions.map((subject) => (
                  <NativeSelectOption key={subject} value={subject}>
                    {subject}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Summary label="プレビューテキスト" value={selected.content.previewText} />
            <Summary label="送信タイミング" value={selected.timing} />
            {previews[selected.emailRef] ? (
              <iframe
                title={`${selected.name}のプレビュー`}
                srcDoc={previews[selected.emailRef]}
                sandbox=""
                className="h-96 w-full rounded-lg border"
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automationフロー</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {proposal.definition.nodes.map((node, index) => (
              <li key={node.id} className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{index + 1}</Badge>
                <span>{nodeLabel(node)}</span>
                <span className="text-muted-foreground">{nodeTypeLabel(node.type)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">計測</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Summary label="主要成果" value={proposal.measurement.primaryOutcome} />
          <Summary label="早期シグナル" value={proposal.measurement.earlySignal} />
          <Summary label="ベースライン" value={proposal.measurement.baseline} />
          <Summary label="目標" value={proposal.measurement.target} />
        </CardContent>
      </Card>
      {proposal.assumptions.length > 0 ? (
        <Alert>
          <Info />
          <AlertTitle>AIが置いた前提</AlertTitle>
          <AlertDescription>{proposal.assumptions.join(" / ")}</AlertDescription>
        </Alert>
      ) : null}
      {proposal.warnings.length > 0 ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>確認事項</AlertTitle>
          <AlertDescription>{proposal.warnings.join(" / ")}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 leading-5">{value}</div>
    </div>
  );
}
