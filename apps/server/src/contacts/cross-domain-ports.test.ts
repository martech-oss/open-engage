import { describe, expect, it, vi } from "vitest";

import { addContactSegment, type AddContactSegmentPorts } from "./resource-service";
import { type ContactApiEventPorts, recordContactApiEvent } from "./service";

describe("contact cross-domain ports", () => {
  it("does not record an API event when the active contact is absent", async () => {
    const recordEvent = vi.fn<ContactApiEventPorts["recordEvent"]>();

    await expect(
      recordContactApiEvent(
        "workspace-1",
        {
          contactId: "missing-contact",
          eventName: "plan_upgraded",
          source: "api",
          properties: { plan: "pro" },
        },
        {
          findActiveContactId: async () => null,
          recordEvent,
        },
      ),
    ).resolves.toEqual({ kind: "contact_not_found" });
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records one mapped API event after resolving the active contact", async () => {
    const recordEvent = vi.fn<ContactApiEventPorts["recordEvent"]>().mockResolvedValue({
      eventId: "event-1",
      enrollmentCount: 2,
    });

    await expect(
      recordContactApiEvent(
        "workspace-1",
        {
          contactId: "contact-1",
          eventName: "delivered",
          source: "webhook",
          properties: { messageId: "message-1" },
          occurredAt: "2026-08-26T00:00:00.000Z",
        },
        {
          findActiveContactId: async () => "active-contact-1",
          recordEvent,
        },
      ),
    ).resolves.toEqual({ kind: "recorded", eventId: "event-1", enrollmentCount: 2 });
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      contactId: "active-contact-1",
      type: "webhook_event",
      resourceType: "webhook",
      resourceId: "delivered",
      properties: { messageId: "message-1" },
      occurredAt: "2026-08-26T00:00:00.000Z",
    });
  });

  it("stops before cross-domain effects when segment membership is rejected", async () => {
    const addMembership = vi.fn<AddContactSegmentPorts["addMembership"]>().mockResolvedValue(false);
    const updateMemberCount = vi.fn<AddContactSegmentPorts["updateMemberCount"]>();
    const recordJoined = vi.fn<AddContactSegmentPorts["recordJoined"]>();
    const ports: AddContactSegmentPorts = {
      addMembership,
      updateMemberCount,
      recordJoined,
    };

    await expect(
      addContactSegment({ contactId: "contact-1", resourceId: "segment-1" }, ports),
    ).resolves.toBe(false);
    expect(addMembership).toHaveBeenCalledTimes(1);
    expect(updateMemberCount).not.toHaveBeenCalled();
    expect(recordJoined).not.toHaveBeenCalled();
  });

  it("updates the count then records one join after membership commits", async () => {
    const order: string[] = [];
    const addMembership = vi.fn<AddContactSegmentPorts["addMembership"]>(async () => {
      order.push("commit");
      return true;
    });
    const updateMemberCount = vi.fn<AddContactSegmentPorts["updateMemberCount"]>(async () => {
      order.push("count");
    });
    const recordJoined = vi.fn<AddContactSegmentPorts["recordJoined"]>(async () => {
      order.push("event");
    });
    const ports: AddContactSegmentPorts = {
      addMembership,
      updateMemberCount,
      recordJoined,
    };

    await expect(
      addContactSegment({ contactId: "contact-1", resourceId: "segment-1" }, ports),
    ).resolves.toBe(true);
    expect(order).toEqual(["commit", "count", "event"]);
    expect(updateMemberCount).toHaveBeenCalledOnce();
    expect(recordJoined).toHaveBeenCalledOnce();
    expect(recordJoined).toHaveBeenCalledWith({
      contactId: "contact-1",
      segmentId: "segment-1",
    });
  });
});
