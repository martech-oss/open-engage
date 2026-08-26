import { describe, expect, it } from "vitest";

import type { SegmentFilter } from "@openengage/core/segments";

import {
  SegmentCommandService,
  type SegmentCommandPorts,
  type SegmentCreateInput,
  type SegmentUpdateInput,
} from "./command-service";

const dynamicFilter: SegmentFilter = {
  kind: "condition",
  field: "email",
  operator: "contains",
  value: "@example.com",
};

const dynamicCreate: SegmentCreateInput = {
  name: "Customers",
  description: "Active customers",
  kind: "dynamic",
  filter: dynamicFilter,
};

const dynamicUpdate: SegmentUpdateInput = {
  id: "segment-1",
  name: "Customers",
  slug: "customers",
  description: "Active customers",
  kind: "dynamic",
  filter: dynamicFilter,
  membershipSource: null,
};

interface Harness {
  service: SegmentCommandService;
  order: string[];
  evaluationStateCalls: unknown[][];
  counts: {
    audit: number;
    create: number;
    queue: number;
    refreshMemberships: number;
    setEvaluationState: number;
    update: number;
  };
  ports: SegmentCommandPorts;
}

function harness(overrides: Partial<SegmentCommandPorts> = {}): Harness {
  const order: string[] = [];
  const evaluationStateCalls: unknown[][] = [];
  const counts = {
    audit: 0,
    create: 0,
    queue: 0,
    refreshMemberships: 0,
    setEvaluationState: 0,
    update: 0,
  };
  const repository: SegmentCommandPorts["repository"] = {
    isSlugAvailable: async () => true,
    createSegment: async () => {
      counts.create += 1;
      order.push("commit");
      return {
        id: "segment-1",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      };
    },
    updateSegment: async () => {
      counts.update += 1;
      order.push("commit");
      return { filterVersion: 2 };
    },
    findSegmentDefinition: async () => ({ kind: "dynamic", filterVersion: 3 }),
    setEvaluationState: async (...args: unknown[]) => {
      counts.setEvaluationState += 1;
      evaluationStateCalls.push(args);
      order.push("commit");
    },
  };
  const ports: SegmentCommandPorts = {
    repository,
    validateFilter: async () => ({ valid: true }),
    resolveBrief: async () => ({ kind: "ok", brief: undefined }),
    nextAvailableSlug: async () => "customers",
    classifyWriteError: () => undefined,
    refreshMemberships: async () => {
      counts.refreshMemberships += 1;
      order.push("refresh-memberships");
    },
    enqueueRefresh: async () => {
      counts.queue += 1;
      order.push("queue");
    },
    writeAudit: async () => {
      counts.audit += 1;
      order.push("audit");
    },
    defer: (promise) => {
      void promise;
    },
    ...overrides,
  };
  return {
    service: new SegmentCommandService({ workspaceId: "workspace-1", userId: "user-1" }, ports),
    order,
    evaluationStateCalls,
    counts,
    ports,
  };
}

describe("SegmentCommandService", () => {
  it("rejects a dynamic segment without a filter before any persistence or side effect", async () => {
    const target = harness();

    const outcome = await target.service.create({ ...dynamicCreate, filter: undefined });

    expect(outcome).toEqual({ kind: "filter_required" });
    expect(target.counts).toEqual({
      audit: 0,
      create: 0,
      queue: 0,
      refreshMemberships: 0,
      setEvaluationState: 0,
      update: 0,
    });
  });

  it("rejects an invalid filter before resolving a brief or committing", async () => {
    let briefResolutions = 0;
    const target = harness({
      validateFilter: async () => ({ valid: false }),
      resolveBrief: async () => {
        briefResolutions += 1;
        return { kind: "ok", brief: undefined };
      },
    });

    const outcome = await target.service.create(dynamicCreate);

    expect(outcome).toEqual({ kind: "invalid_segment_filter" });
    expect(briefResolutions).toBe(0);
    expect(target.counts.create).toBe(0);
    expect(target.counts.audit).toBe(0);
  });

  it("commits a dynamic segment before refreshing memberships and auditing exactly once", async () => {
    const target = harness();

    const outcome = await target.service.create(dynamicCreate);

    expect(outcome).toEqual({
      kind: "ok",
      segment: {
        id: "segment-1",
        name: "Customers",
        slug: "customers",
        kind: "dynamic",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      },
    });
    expect(target.order).toEqual(["commit", "refresh-memberships", "audit"]);
    expect(target.counts.refreshMemberships).toBe(1);
    expect(target.counts.audit).toBe(1);
  });

  it("maps a requested slug collision and does not schedule post-commit work", async () => {
    const conflict = new Error("unique");
    const target = harness({
      repository: {
        ...harness().ports.repository,
        createSegment: async () => {
          throw conflict;
        },
      },
      classifyWriteError: (error) => (error === conflict ? "slug_conflict" : undefined),
    });

    const outcome = await target.service.create({ ...dynamicCreate, slug: "customers" });

    expect(outcome).toEqual({ kind: "segment_conflict", cause: conflict });
    expect(target.counts.refreshMemberships).toBe(0);
    expect(target.counts.audit).toBe(0);
  });

  it("returns not found from update without queueing or auditing", async () => {
    const target = harness({
      repository: {
        ...harness().ports.repository,
        updateSegment: async () => null,
      },
    });

    const outcome = await target.service.update(dynamicUpdate);

    expect(outcome).toEqual({ kind: "segment_not_found" });
    expect(target.counts.queue).toBe(0);
    expect(target.counts.audit).toBe(0);
  });

  it("queues a dynamic refresh only after update commit, then audits exactly once", async () => {
    const target = harness();

    const outcome = await target.service.update(dynamicUpdate);

    expect(outcome).toEqual({ kind: "ok", segment: { filterVersion: 2 } });
    expect(target.order).toEqual(["commit", "queue", "audit"]);
    expect(target.counts.queue).toBe(1);
    expect(target.counts.audit).toBe(1);
  });

  it("does not mutate, queue, or audit when refresh target is missing", async () => {
    const target = harness({
      repository: {
        ...harness().ports.repository,
        findSegmentDefinition: async () => null,
      },
    });

    const outcome = await target.service.refresh("missing");

    expect(outcome).toEqual({ kind: "segment_not_found" });
    expect(target.counts.setEvaluationState).toBe(0);
    expect(target.counts.queue).toBe(0);
    expect(target.counts.audit).toBe(0);
  });

  it("persists refresh state before queueing and auditing exactly once", async () => {
    const target = harness();

    const outcome = await target.service.refresh("segment-1");

    expect(outcome).toEqual({ kind: "ok" });
    expect(target.order).toEqual(["commit", "queue", "audit"]);
    expect(target.evaluationStateCalls).toEqual([
      ["segment-1", "pending", null, { kind: "dynamic", filterVersion: 3 }],
    ]);
    expect(target.counts.setEvaluationState).toBe(1);
    expect(target.counts.queue).toBe(1);
    expect(target.counts.audit).toBe(1);
  });

  it("queues a static recount without leaving the segment pending", async () => {
    const target = harness({
      repository: {
        ...harness().ports.repository,
        findSegmentDefinition: async () => ({ kind: "static", filterVersion: 4 }),
      },
    });

    const outcome = await target.service.refresh("segment-1");

    expect(outcome).toEqual({ kind: "ok" });
    expect(target.order).toEqual(["queue", "audit"]);
    expect(target.evaluationStateCalls).toEqual([]);
    expect(target.counts.setEvaluationState).toBe(0);
    expect(target.counts.queue).toBe(1);
    expect(target.counts.audit).toBe(1);
  });
});
