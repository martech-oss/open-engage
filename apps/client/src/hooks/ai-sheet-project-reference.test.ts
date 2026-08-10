import { describe, expectTypeOf, it } from "vitest";

import type { AutomationAiSheetProps } from "@/features/automations/automation-ai-sheet";
import type { EmailSequenceAiSheetProps } from "@/features/automations/email-sequence-ai-sheet";
import type { SegmentAiSheetProps } from "@/features/segments/segment-ai-sheet";

type PartialReference = { projectId: string; briefRevision?: undefined };
type FullReference = { projectId: string; briefRevision: number };
type SheetCommon<T> = Omit<T, "projectId" | "briefRevision">;
type WithPartialReference<T> = SheetCommon<T> & PartialReference;
type WithFullReference<T> = SheetCommon<T> & FullReference;

describe("AI sheet project brief references", () => {
  it("accepts an exact reference or no reference, but rejects partial references", () => {
    expectTypeOf<SheetCommon<SegmentAiSheetProps>>().toMatchTypeOf<SegmentAiSheetProps>();
    expectTypeOf<WithFullReference<SegmentAiSheetProps>>().toMatchTypeOf<SegmentAiSheetProps>();
    expectTypeOf<
      WithPartialReference<SegmentAiSheetProps>
    >().not.toMatchTypeOf<SegmentAiSheetProps>();

    expectTypeOf<SheetCommon<AutomationAiSheetProps>>().toMatchTypeOf<AutomationAiSheetProps>();
    expectTypeOf<
      WithFullReference<AutomationAiSheetProps>
    >().toMatchTypeOf<AutomationAiSheetProps>();
    expectTypeOf<
      WithPartialReference<AutomationAiSheetProps>
    >().not.toMatchTypeOf<AutomationAiSheetProps>();

    expectTypeOf<
      SheetCommon<EmailSequenceAiSheetProps>
    >().toMatchTypeOf<EmailSequenceAiSheetProps>();
    expectTypeOf<
      WithFullReference<EmailSequenceAiSheetProps>
    >().toMatchTypeOf<EmailSequenceAiSheetProps>();
    expectTypeOf<
      WithPartialReference<EmailSequenceAiSheetProps>
    >().not.toMatchTypeOf<EmailSequenceAiSheetProps>();
  });
});
