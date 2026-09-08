import { describe, expect, it } from "vitest";

import type { Contact } from "@openengage/core/contacts";

import {
  ContactCommandService,
  type ContactCommandPersistencePort,
  type ContactCommandPorts,
} from "./command-service";

const activeContact: Contact = {
  id: "contact-1",
  workspaceId: "workspace-1",
  visitorId: null,
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  externalId: null,
  stage: "lead",
  ownerUserId: null,
  lifecycleStage: "lead",
  score: 0,
  gradePoints: 0,
  status: "active",
  archivedAt: null,
  customFields: {},
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

interface Harness {
  service: ContactCommandService;
  order: string[];
  counts: {
    archive: number;
    audit: number;
    create: number;
    defer: number;
    find: number;
    processCreatedEvent: number;
    reconcile: number;
    update: number;
  };
}

function harness(
  overrides: Partial<Omit<ContactCommandPorts, "persistence">> & {
    persistence?: Partial<ContactCommandPersistencePort>;
  } = {},
): Harness {
  const order: string[] = [];
  const counts = {
    archive: 0,
    audit: 0,
    create: 0,
    defer: 0,
    find: 0,
    processCreatedEvent: 0,
    reconcile: 0,
    update: 0,
  };
  const persistence: ContactCommandPersistencePort = {
    create: async () => {
      counts.create += 1;
      order.push("commit");
      return { kind: "ok", contact: activeContact, eventId: "event-1" };
    },
    find: async () => {
      counts.find += 1;
      order.push("find");
      return activeContact;
    },
    update: async () => {
      counts.update += 1;
      order.push("commit");
      return { ...activeContact, firstName: "Grace" };
    },
    archive: async () => {
      counts.archive += 1;
      order.push("commit");
      return true;
    },
    ...overrides.persistence,
  };
  const ports: ContactCommandPorts = {
    processCreatedEvent: async (eventId) => {
      counts.processCreatedEvent += 1;
      order.push(`process:${eventId}`);
    },
    reconcileContact: async (contactId) => {
      counts.reconcile += 1;
      order.push(`reconcile:${contactId}`);
    },
    writeAudit: async ({ resourceId }) => {
      counts.audit += 1;
      order.push(`audit:${resourceId}`);
    },
    defer: (promise) => {
      counts.defer += 1;
      order.push("defer");
      void promise;
    },
    ...overrides,
    persistence,
  };
  return {
    service: new ContactCommandService(ports),
    order,
    counts,
  };
}

describe("ContactCommandService", () => {
  it("commits create before processing its event and schedules one audit", async () => {
    const target = harness();

    const outcome = await target.service.create({
      email: "ada@example.com",
      customFields: {},
      tagId: "tag-1",
    });

    expect(outcome).toEqual({ kind: "ok", contact: activeContact });
    expect(target.order).toEqual(["commit", "process:event-1", "audit:contact-1", "defer"]);
    expect(target.counts).toMatchObject({
      create: 1,
      processCreatedEvent: 1,
      audit: 1,
      defer: 1,
    });
  });

  it("returns a contact conflict without event processing or audit scheduling", async () => {
    const conflict = new Error("duplicate email");
    const target = harness({
      persistence: {
        create: async () => {
          target.counts.create += 1;
          return { kind: "contact_conflict", cause: conflict };
        },
      },
    });

    const outcome = await target.service.create({
      email: "ada@example.com",
      customFields: {},
    });

    expect(outcome).toEqual({ kind: "contact_conflict", cause: conflict });
    expect(target.counts).toMatchObject({
      create: 1,
      processCreatedEvent: 0,
      audit: 0,
      defer: 0,
    });
  });

  it("returns the invalid relation field without any post-persistence side effect", async () => {
    const invalid = new Error("missing static segment");
    const target = harness({
      persistence: {
        create: async () => ({
          kind: "contact_relation_invalid",
          field: "segmentId",
          cause: invalid,
        }),
      },
    });

    const outcome = await target.service.create({
      email: "ada@example.com",
      customFields: {},
      segmentId: "dynamic-segment",
    });

    expect(outcome).toEqual({
      kind: "contact_relation_invalid",
      field: "segmentId",
      cause: invalid,
    });
    expect(target.counts.processCreatedEvent).toBe(0);
    expect(target.counts.audit).toBe(0);
    expect(target.counts.defer).toBe(0);
  });

  it("does not start event or audit work when create persistence rejects", async () => {
    const failure = new Error("commit failed");
    const target = harness({
      persistence: {
        create: async () => {
          throw failure;
        },
      },
    });

    await expect(
      target.service.create({ email: "ada@example.com", customFields: {} }),
    ).rejects.toBe(failure);
    expect(target.counts.processCreatedEvent).toBe(0);
    expect(target.counts.audit).toBe(0);
    expect(target.counts.defer).toBe(0);
  });

  it("propagates created-event failure after commit without scheduling an audit", async () => {
    const failure = new Error("event processing failed");
    const target = harness({
      processCreatedEvent: async (eventId) => {
        target.counts.processCreatedEvent += 1;
        target.order.push(`process:${eventId}`);
        throw failure;
      },
    });

    await expect(
      target.service.create({ email: "ada@example.com", customFields: {} }),
    ).rejects.toBe(failure);
    expect(target.order).toEqual(["commit", "process:event-1"]);
    expect(target.counts).toMatchObject({
      create: 1,
      processCreatedEvent: 1,
      audit: 0,
      defer: 0,
    });
  });

  it("returns not found from update without persisting or reconciling", async () => {
    const target = harness({ persistence: { find: async () => null } });

    const outcome = await target.service.update({ id: "missing", firstName: "Grace" });

    expect(outcome).toEqual({ kind: "contact_not_found" });
    expect(target.counts.update).toBe(0);
    expect(target.counts.reconcile).toBe(0);
  });

  it("returns archived from update without persisting or reconciling", async () => {
    const target = harness({
      persistence: {
        find: async () => ({
          ...activeContact,
          status: "archived",
          archivedAt: "2026-08-26T01:00:00.000Z",
        }),
      },
    });

    const outcome = await target.service.update({ id: activeContact.id, firstName: "Grace" });

    expect(outcome).toEqual({ kind: "contact_archived" });
    expect(target.counts.update).toBe(0);
    expect(target.counts.reconcile).toBe(0);
  });

  it("returns not found when update loses its target before commit", async () => {
    const target = harness({ persistence: { update: async () => null } });

    const outcome = await target.service.update({ id: activeContact.id, firstName: "Grace" });

    expect(outcome).toEqual({ kind: "contact_not_found" });
    expect(target.counts.reconcile).toBe(0);
  });

  it("reconciles exactly once after a successful update commit", async () => {
    const target = harness();

    const outcome = await target.service.update({ id: activeContact.id, firstName: "Grace" });

    expect(outcome).toEqual({
      kind: "ok",
      contact: { ...activeContact, firstName: "Grace" },
    });
    expect(target.order).toEqual(["find", "commit", "reconcile:contact-1"]);
    expect(target.counts.update).toBe(1);
    expect(target.counts.reconcile).toBe(1);
  });

  it("propagates reconciliation failure exactly once after an update commit", async () => {
    const failure = new Error("reconciliation unavailable");
    const target = harness({
      reconcileContact: async (contactId) => {
        target.counts.reconcile += 1;
        target.order.push(`reconcile:${contactId}`);
        throw failure;
      },
    });

    await expect(target.service.update({ id: activeContact.id, firstName: "Grace" })).rejects.toBe(
      failure,
    );
    expect(target.order).toEqual(["find", "commit", "reconcile:contact-1"]);
    expect(target.counts.update).toBe(1);
    expect(target.counts.reconcile).toBe(1);
  });

  it("returns not found from archive without reconciliation", async () => {
    const target = harness({ persistence: { archive: async () => false } });

    const outcome = await target.service.archive("missing");

    expect(outcome).toEqual({ kind: "contact_not_found" });
    expect(target.counts.reconcile).toBe(0);
  });

  it("reconciles exactly once after a successful archive commit", async () => {
    const target = harness();

    const outcome = await target.service.archive(activeContact.id);

    expect(outcome).toEqual({ kind: "ok" });
    expect(target.order).toEqual(["commit", "reconcile:contact-1"]);
    expect(target.counts.archive).toBe(1);
    expect(target.counts.reconcile).toBe(1);
  });

  it("propagates reconciliation failure exactly once after an archive commit", async () => {
    const failure = new Error("reconciliation unavailable");
    const target = harness({
      reconcileContact: async (contactId) => {
        target.counts.reconcile += 1;
        target.order.push(`reconcile:${contactId}`);
        throw failure;
      },
    });

    await expect(target.service.archive(activeContact.id)).rejects.toBe(failure);
    expect(target.order).toEqual(["commit", "reconcile:contact-1"]);
    expect(target.counts.archive).toBe(1);
    expect(target.counts.reconcile).toBe(1);
  });
});
