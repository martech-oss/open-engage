import { type OpenEngageDatabase } from "@openengage/database/client";
import {
  ContactEventRepository,
  type ContactEventProjection,
  type ContactEventRecord,
} from "@openengage/database/contacts";
import { uuidv7 } from "@openengage/database/shared";

export interface ContactEventInput {
  id?: string;
  workspaceId: string;
  contactId: string | null;
  visitorId?: string | null;
  type: string;
  resourceType?: string | null;
  resourceId?: string | null;
  properties?: Record<string, unknown>;
  occurredAt?: string;
  queue?: Queue;
}

export type ProcessableContactEvent = ContactEventRecord & { contactId: string };
export type ContactEventProjectionResult = {
  outcome: "completed" | "skipped";
  enrollmentCount: number;
};
export type ContactEventProjectionRunner = (context: {
  database: OpenEngageDatabase;
  event: ProcessableContactEvent;
  projection: ContactEventProjection;
  queue: Queue | undefined;
}) => Promise<ContactEventProjectionResult>;

export class ContactEventProcessor {
  public constructor(
    private readonly database: OpenEngageDatabase,
    private readonly runProjection: ContactEventProjectionRunner,
    private readonly runVisitorProjection?: (event: ContactEventRecord) => Promise<void>,
  ) {}

  public async record(
    input: ContactEventInput,
  ): Promise<{ eventId: string; enrollmentCount: number }> {
    const eventId = input.id ?? uuidv7();
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    await new ContactEventRepository(this.database).create({
      id: eventId,
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      visitorId: input.visitorId ?? null,
      type: input.type,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      properties: input.properties ?? {},
      occurredAt,
      createdAt: new Date().toISOString(),
    });
    return this.process(eventId, input.queue);
  }

  public async retryDue(
    queue: Queue,
    limit = 50,
  ): Promise<Array<{ eventId: string; error: unknown }>> {
    const repository = new ContactEventRepository(this.database);
    const eventIds = await repository.listDueIds(new Date().toISOString(), limit);
    const failures: Array<{ eventId: string; error: unknown }> = [];
    for (const eventId of eventIds) {
      try {
        await this.process(eventId, queue);
      } catch (error) {
        failures.push({ eventId, error });
      }
    }
    return failures;
  }

  public async process(
    eventId: string,
    queue?: Queue,
  ): Promise<{ eventId: string; enrollmentCount: number }> {
    const repository = new ContactEventRepository(this.database);
    const startedAt = new Date();
    const leaseId = uuidv7();
    const event = await repository.claim(
      eventId,
      startedAt.toISOString(),
      leaseId,
      new Date(startedAt.getTime() + 30_000).toISOString(),
    );
    if (!event) return { eventId, enrollmentCount: 0 };
    try {
      // Visitor metrics reduce original event timestamps, independently of contact-history projections.
      // This also recovers a measured event whose first projection failed before contact identification.
      await this.runVisitorProjection?.(event);
      if (
        !event.contactId ||
        !(await repository.isContactProcessable(event.workspaceId, event.contactId))
      ) {
        await repository.skipPending(event.id, leaseId, new Date().toISOString());
        await repository.markProcessed(event.id, leaseId, new Date().toISOString());
        return { eventId, enrollmentCount: 0 };
      }

      let enrollmentCount = 0;
      for (const projection of await repository.pendingProjections(event.id)) {
        if (
          event.replayMode === "history" &&
          !["scoring", "grade", "campaign"].includes(projection)
        ) {
          await repository.finishProjection(
            event.id,
            leaseId,
            projection,
            "skipped",
            new Date().toISOString(),
          );
          continue;
        }
        if (!(await repository.isContactProcessable(event.workspaceId, event.contactId))) {
          await repository.skipPending(event.id, leaseId, new Date().toISOString());
          break;
        }
        const result = await this.runProjection({
          database: this.database,
          event: event as ProcessableContactEvent,
          projection,
          queue,
        });
        enrollmentCount += result.enrollmentCount;
        await repository.finishProjection(
          event.id,
          leaseId,
          projection,
          result.outcome,
          new Date().toISOString(),
        );
      }
      await repository.markProcessed(event.id, leaseId, new Date().toISOString());
      return { eventId, enrollmentCount };
    } catch (error) {
      await repository.markFailed(
        event.id,
        leaseId,
        error,
        new Date(Date.now() + 60_000).toISOString(),
      );
      throw error;
    }
  }
}
