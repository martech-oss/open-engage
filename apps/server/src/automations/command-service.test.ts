import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";

import {
  AutomationCommandService,
  type AutomationCommandPorts,
  type AutomationSequenceInput,
} from "./command-service";

const validDefinition: AutomationDefinition = {
  name: "Welcome",
  description: "",
  timezone: "UTC",
  nodes: [
    {
      id: "source",
      type: "source",
      position: { x: 0, y: 0 },
      config: { source: "contact_created", reentry: "once" },
    },
  ],
  edges: [],
};

interface Harness {
  service: AutomationCommandService;
  order: string[];
  counts: {
    audit: number;
    create: number;
    loadResourceIssues: number;
    publish: number;
    save: number;
    sequence: number;
    status: number;
  };
  ports: AutomationCommandPorts;
}

function harness(overrides: Partial<AutomationCommandPorts> = {}): Harness {
  const order: string[] = [];
  const counts = {
    audit: 0,
    create: 0,
    loadResourceIssues: 0,
    publish: 0,
    save: 0,
    sequence: 0,
    status: 0,
  };
  const repository: AutomationCommandPorts["repository"] = {
    createAutomation: async () => {
      counts.create += 1;
      order.push("commit");
      return { id: "automation-1", draftVersionId: "draft-1" };
    },
    saveDraft: async () => {
      counts.save += 1;
      order.push("commit");
      return true;
    },
    findPublishableDraft: async () => ({
      draftVersionId: "draft-1",
      version: 1,
      graph: validDefinition,
    }),
    publishDraft: async () => {
      counts.publish += 1;
      order.push("commit");
      return { draftVersionId: "draft-2" };
    },
    setAutomationStatus: async () => {
      counts.status += 1;
      order.push("commit");
      return true;
    },
  };
  const ports: AutomationCommandPorts = {
    repository,
    resolveBrief: async () => ({ kind: "ok", brief: undefined }),
    classifyWriteError: () => undefined,
    loadResourceIssues: async () => {
      counts.loadResourceIssues += 1;
      return [];
    },
    applySequence: async () => {
      counts.sequence += 1;
      order.push("commit");
      return {
        created: true,
        result: {
          automationId: "automation-1",
          draftVersionId: "draft-1",
          templates: [],
          capabilityState: "transactional-compatible",
        },
      };
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
    service: new AutomationCommandService({ userId: "user-1" }, ports),
    order,
    counts,
    ports,
  };
}

describe("AutomationCommandService", () => {
  it("returns a brief conflict from create without adding post-commit side effects", async () => {
    const conflict = new Error("brief revision changed");
    const target = harness({
      repository: {
        ...harness().ports.repository,
        createAutomation: async () => {
          throw conflict;
        },
      },
      classifyWriteError: (error) => (error === conflict ? "brief_conflict" : undefined),
    });

    const outcome = await target.service.create(validDefinition);

    expect(outcome).toEqual({ kind: "brief_revision_conflict" });
    expect(target.counts.audit).toBe(0);
  });

  it("returns the created automation DTO on success", async () => {
    const target = harness();

    const outcome = await target.service.create(validDefinition);

    expect(outcome).toEqual({
      kind: "ok",
      automation: { id: "automation-1", draftVersionId: "draft-1" },
    });
    expect(target.counts.create).toBe(1);
  });

  it("distinguishes a non-editable draft from a saved draft", async () => {
    const notEditable = harness({
      repository: { ...harness().ports.repository, saveDraft: async () => false },
    });

    expect(await notEditable.service.saveDraft({ id: "automation-1", ...validDefinition })).toEqual(
      { kind: "draft_not_editable" },
    );
    expect(await harness().service.saveDraft({ id: "automation-1", ...validDefinition })).toEqual({
      kind: "ok",
    });
  });

  it("stops publish before validation or writes when the draft is missing", async () => {
    const target = harness({
      repository: {
        ...harness().ports.repository,
        findPublishableDraft: async () => null,
      },
    });

    const outcome = await target.service.publish("missing");

    expect(outcome).toEqual({ kind: "draft_not_found" });
    expect(target.counts.loadResourceIssues).toBe(0);
    expect(target.counts.publish).toBe(0);
  });

  it("rejects an invalid graph before loading resources or publishing", async () => {
    const invalidDefinition: AutomationDefinition = { ...validDefinition, nodes: [] };
    const target = harness({
      repository: {
        ...harness().ports.repository,
        findPublishableDraft: async () => ({
          draftVersionId: "draft-1",
          version: 1,
          graph: invalidDefinition,
        }),
      },
    });

    const outcome = await target.service.publish("automation-1");

    expect(outcome.kind).toBe("invalid_graph");
    expect(outcome).toMatchObject({ message: undefined });
    expect(target.counts.loadResourceIssues).toBe(0);
    expect(target.counts.publish).toBe(0);
  });

  it("returns resource validation issues without publishing", async () => {
    const issues = [
      {
        kind: "form" as const,
        resourceId: "missing",
        nodeId: "source",
        message: "missing form",
      },
    ];
    const target = harness({ loadResourceIssues: async () => issues });

    const outcome = await target.service.publish("automation-1");

    expect(outcome).toEqual({
      kind: "invalid_graph",
      message: "利用できないワークスペースリソースを参照しているノードがあります",
      issues,
    });
    expect(target.counts.publish).toBe(0);
  });

  it("publishes only after graph and resource validation", async () => {
    const target = harness();

    const outcome = await target.service.publish("automation-1");

    expect(outcome).toEqual({
      kind: "ok",
      automation: { publishedVersionId: "draft-1", draftVersionId: "draft-2" },
    });
    expect(target.counts.loadResourceIssues).toBe(1);
    expect(target.counts.publish).toBe(1);
    expect(target.order).toEqual(["commit"]);
  });

  it("maps a non-changeable status separately from success", async () => {
    const blocked = harness({
      repository: {
        ...harness().ports.repository,
        setAutomationStatus: async () => false,
      },
    });

    expect(await blocked.service.setStatus("automation-1", "paused")).toEqual({
      kind: "not_changeable",
    });
    expect(await harness().service.setStatus("automation-1", "paused")).toEqual({
      kind: "ok",
      status: "paused",
    });
  });

  it("audits a newly applied unlinked sequence exactly once after its commit", async () => {
    const target = harness();
    const input = {
      proposalId: "proposal-1",
      projectId: undefined,
      briefRevision: undefined,
    } as AutomationSequenceInput;

    const outcome = await target.service.applyEmailSequence(input);

    expect(outcome).toEqual({
      kind: "ok",
      sequence: {
        automationId: "automation-1",
        draftVersionId: "draft-1",
        templates: [],
        capabilityState: "transactional-compatible",
      },
    });
    expect(target.order).toEqual(["commit", "audit"]);
    expect(target.counts.audit).toBe(1);
    expect(target.counts.sequence).toBe(1);
  });

  it.each([
    ["brief conflicts", "brief_conflict", { kind: "brief_revision_conflict" }],
    ["sequence conflicts", "sequence_conflict", { kind: "sequence_conflict" }],
    ["invalid sequences", "invalid_sequence", { kind: "invalid_sequence" }],
  ] as const)("returns %s without auditing", async (_name, classification, expected) => {
    const failure = new Error(classification);
    let sequenceAttempts = 0;
    const target = harness({
      applySequence: async () => {
        sequenceAttempts += 1;
        throw failure;
      },
      classifyWriteError: (error) => (error === failure ? classification : undefined),
    });

    const outcome = await target.service.applyEmailSequence({
      proposalId: "proposal-1",
      projectId: undefined,
      briefRevision: undefined,
    } as AutomationSequenceInput);

    expect(outcome).toEqual(expected);
    expect(sequenceAttempts).toBe(1);
    expect(target.counts.audit).toBe(0);
    expect(target.order).toEqual([]);
  });

  it.each([
    ["missing", { kind: "brief_not_found" }],
    ["unapproved", { kind: "brief_not_approved" }],
    ["revision-conflicted", { kind: "brief_revision_conflict" }],
    ["forbidden", { kind: "forbidden" }],
  ] as const)("returns a %s brief failure before applying or auditing", async (_name, failure) => {
    const target = harness({ resolveBrief: async () => failure });

    const outcome = await target.service.applyEmailSequence({
      proposalId: "proposal-1",
      projectId: "brief-1",
      briefRevision: 2,
    } as AutomationSequenceInput);

    expect(outcome).toEqual(failure);
    expect(target.counts.sequence).toBe(0);
    expect(target.counts.audit).toBe(0);
    expect(target.order).toEqual([]);
  });
});
