import { describe, expect, it } from "vitest";

import {
  dealCreateSchema,
  dealMoveSchema,
  dealPipelineCreateSchema,
  dealPipelineUpdateSchema,
  dealTaskCreateSchema,
  dealTaskUpdateSchema,
  dealUpdateSchema,
} from "./schema";

describe("deal schemas", () => {
  const validDeal = {
    name: "Acme MA導入",
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    value: 1_200_000,
    currency: "jpy",
    ownerUserId: null,
    contactId: null,
    companyId: null,
    expectedCloseDate: "2026-09-30",
    description: "導入条件を確認中",
  };

  it("normalizes a valid deal", () => {
    expect(dealCreateSchema.parse(validDeal)).toMatchObject({
      currency: "JPY",
      status: "open",
      value: 1_200_000,
    });
  });

  it("rejects invalid values, currencies, and dates", () => {
    expect(dealCreateSchema.safeParse({ ...validDeal, value: -1 }).success).toBe(false);
    expect(dealCreateSchema.safeParse({ ...validDeal, currency: "JP" }).success).toBe(false);
    expect(
      dealCreateSchema.safeParse({ ...validDeal, expectedCloseDate: "2026-02-30" }).success,
    ).toBe(false);
  });

  it("validates stage movement", () => {
    expect(dealMoveSchema.safeParse({ stageId: "stage-2" }).success).toBe(true);
    expect(dealMoveSchema.safeParse({ stageId: "" }).success).toBe(false);
  });

  it("validates task creation and status updates", () => {
    expect(
      dealTaskCreateSchema.parse({
        title: "提案書を送付",
        type: "email",
        dueAt: "2026-08-01T03:00:00.000Z",
      }),
    ).toMatchObject({
      type: "email",
      notes: "",
    });
    expect(dealTaskCreateSchema.safeParse({ title: "", type: "call" }).success).toBe(false);
    expect(dealTaskUpdateSchema.safeParse({ status: "completed" }).success).toBe(true);
    expect(dealTaskUpdateSchema.safeParse({ status: "cancelled" }).success).toBe(false);
  });

  it("does not apply create defaults to partial updates", () => {
    expect(dealUpdateSchema.parse({ status: "won" })).toEqual({ status: "won" });
    expect(dealTaskUpdateSchema.parse({ status: "completed" })).toEqual({
      status: "completed",
    });
  });

  it("seeds default stages when creating a pipeline", () => {
    expect(dealPipelineCreateSchema.parse({ name: "インバウンド" })).toMatchObject({
      name: "インバウンド",
      isDefault: false,
      stages: [
        { name: "新規", color: "#64748b", probability: 10 },
        { name: "連絡済み", color: "#3b82f6", probability: 25 },
        { name: "提案", color: "#8b5cf6", probability: 50 },
        { name: "交渉", color: "#f59e0b", probability: 75 },
        { name: "最終確認", color: "#10b981", probability: 90 },
      ],
    });
  });

  it("rejects empty or overlong pipeline stage lists", () => {
    expect(dealPipelineCreateSchema.safeParse({ name: "空", stages: [] }).success).toBe(false);
    expect(
      dealPipelineUpdateSchema.safeParse({
        stages: Array.from({ length: 21 }, (_, index) => ({ name: `S${index}` })),
      }).success,
    ).toBe(false);
  });
});
