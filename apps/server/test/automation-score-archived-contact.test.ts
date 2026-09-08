import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AutomationNode } from "@openengage/core/automations";
import {
  AutomationActionRepository,
  AutomationEngineRepository,
} from "@openengage/database/automations";
import { ContactRepository } from "@openengage/database/contacts";
import {
  automationActionEffects,
  contacts,
  contactCategoryScores,
  createDatabase,
  scoreEvents,
  scoringCategories,
  uuidv7,
} from "@openengage/database/testing";

import { executeNode } from "../src/automations/worker";
import {
  expectJobAndEnrollment,
  graph,
  queueStub,
  runtimeWithJobsQueue,
  seedAutomationJob,
} from "./automation-recovery-test-support";

const scoreCases = [
  { scope: "global", operation: "add", initialCategoryScore: undefined, score: 27, delta: 7 },
  { scope: "global", operation: "set", initialCategoryScore: undefined, score: 7, delta: -13 },
  { scope: "new category", operation: "add", initialCategoryScore: undefined, score: 7, delta: 7 },
  { scope: "new category", operation: "set", initialCategoryScore: undefined, score: 7, delta: 7 },
  { scope: "existing category", operation: "add", initialCategoryScore: 10, score: 17, delta: 7 },
  { scope: "existing category", operation: "set", initialCategoryScore: 10, score: 7, delta: -3 },
] as const;

describe.each(scoreCases)("archived contact: $scope $operation", (testCase) => {
  it.each(["delayed", "running"] as const)(
    "skips every score write for a %s job and permits one application after restoration",
    async (phase) => {
      const categoryId = testCase.scope === "global" ? undefined : uuidv7();
      const node: AutomationNode = {
        id: "score",
        type: "action",
        position: { x: 0, y: 0 },
        config: {
          action: "change_score",
          amount: 7,
          operation: testCase.operation,
          ...(categoryId ? { categoryId } : {}),
        },
      };
      const definition = graph([node]);
      const now = "2026-08-21T00:00:00.000Z";
      const seeded = await seedAutomationJob({
        status: phase === "delayed" ? "pending" : "running",
        leaseId: phase === "delayed" ? null : "score-lease",
        dueAt: now,
        nodeId: node.id,
        graph: definition,
      });
      const db = createDatabase(env.DB);
      const engine = new AutomationEngineRepository(db);
      const contactRepository = new ContactRepository(db, { workspaceId: seeded.workspaceId });
      await db.orm.update(contacts).set({ score: 20 }).where(eq(contacts.id, seeded.contactId));
      if (categoryId) {
        await db.orm.insert(scoringCategories).values({
          id: categoryId,
          workspaceId: seeded.workspaceId,
          name: "Product",
          slug: "product",
          createdAt: now,
          updatedAt: now,
        });
        if (testCase.initialCategoryScore !== undefined) {
          await db.orm.insert(contactCategoryScores).values({
            workspaceId: seeded.workspaceId,
            contactId: seeded.contactId,
            categoryId,
            score: testCase.initialCategoryScore,
            updatedAt: now,
          });
        }
      }

      let leaseId = "score-lease";
      // A running worker may already hold a contact snapshot when archival commits.
      let job =
        phase === "running" ? await engine.findJobForProcessing(seeded.jobId, leaseId) : null;
      expect(await contactRepository.archiveContact(seeded.contactId)).toBe(true);
      if (phase === "delayed") {
        await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "pending", "active");
        const [claim] = await engine.claimDueJobs(
          now,
          "2026-08-21T00:05:00.000Z",
          1,
          seeded.workspaceId,
        );
        leaseId = claim!.leaseId;
        await engine.startLeasedJob(seeded.jobId, leaseId, now);
        job = await engine.findJobForProcessing(seeded.jobId, leaseId);
      }
      expect(job).toMatchObject({ id: seeded.jobId, status: "running", leaseId });

      const readScoreState = async () => ({
        contact: await db.orm
          .select({ score: contacts.score, updatedAt: contacts.updatedAt })
          .from(contacts)
          .where(eq(contacts.id, seeded.contactId))
          .get(),
        categories: await db.orm
          .select({
            score: contactCategoryScores.score,
            updatedAt: contactCategoryScores.updatedAt,
          })
          .from(contactCategoryScores)
          .where(eq(contactCategoryScores.contactId, seeded.contactId)),
        events: await db.orm
          .select({
            delta: scoreEvents.delta,
            reason: scoreEvents.reason,
            enrollmentId: scoreEvents.automationEnrollmentId,
          })
          .from(scoreEvents)
          .where(eq(scoreEvents.contactId, seeded.contactId)),
        effects: await db.orm
          .select({
            effect: automationActionEffects.effect,
            nodeId: automationActionEffects.nodeId,
          })
          .from(automationActionEffects)
          .where(eq(automationActionEffects.jobId, seeded.jobId)),
      });
      const archivedState = await readScoreState();
      expect(archivedState.events).toEqual([]);
      expect(archivedState.effects).toEqual([]);
      const execute = () =>
        executeNode(node, definition, job!, leaseId, runtimeWithJobsQueue(queueStub()), db, engine);

      await execute();
      await execute();
      expect.soft(await readScoreState()).toEqual(archivedState);
      await expectJobAndEnrollment(seeded.jobId, seeded.enrollmentId, "running", "active");

      expect(await contactRepository.restoreContact(seeded.contactId)).toBe(true);
      const restoredState = await readScoreState();
      // Restoration must not let a worker with an obsolete lease consume the effect.
      await new AutomationActionRepository(db).adjustContactScoreForJob(
        job!,
        "stale-lease",
        7,
        now,
        {
          operation: testCase.operation,
          categoryId,
        },
      );
      expect(await readScoreState()).toEqual(restoredState);

      await execute();
      const appliedState = await readScoreState();
      expect.soft(appliedState.contact?.score).toBe(categoryId ? 20 : testCase.score);
      expect
        .soft(appliedState.categories.map((row) => row.score))
        .toEqual(categoryId ? [testCase.score] : []);
      expect.soft(appliedState.events).toEqual([
        {
          delta: testCase.delta,
          reason: categoryId ? `automation:category:${categoryId}` : "automation",
          enrollmentId: seeded.enrollmentId,
        },
      ]);
      expect.soft(appliedState.effects).toEqual([{ effect: "change_score", nodeId: "score" }]);
      await execute();
      expect(await readScoreState()).toEqual(appliedState);
    },
  );
});
