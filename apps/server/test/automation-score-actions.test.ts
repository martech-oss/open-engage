import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  AutomationJobRepository,
  AutomationDecisionRepository,
  AutomationContactActionRepository,
} from "@openengage/database/automations";
import {
  contacts,
  contactCategoryScores,
  scoringCategories,
  createDatabase,
} from "@openengage/database/testing";

import { executeNode } from "../src/automations/worker";
import {
  graph,
  seedAutomationJob,
  queueStub,
  runtimeWithJobsQueue,
} from "./automation-recovery-test-support";
it.each([false, true])("sets score exactly once with category=%s", async (category) => {
  const node = {
    id: "score",
    type: "action" as const,
    position: { x: 0, y: 0 },
    config: {
      action: "change_score" as const,
      amount: 7,
      operation: "set" as const,
      ...(category ? { categoryId: "product" } : {}),
    },
  };
  const definition = graph([node]),
    seed = await seedAutomationJob({
      status: "running",
      leaseId: "lease",
      nodeId: "score",
      graph: definition,
    });
  const db = createDatabase(env.DB),
    engine = new AutomationJobRepository(db);
  await db.orm.update(contacts).set({ score: 20 }).where(eq(contacts.id, seed.contactId));
  if (category) {
    await db.orm.insert(scoringCategories).values({
      id: "product",
      workspaceId: seed.workspaceId,
      name: "Product",
      slug: "product",
      createdAt: "now",
      updatedAt: "now",
    });
    await db.orm.insert(contactCategoryScores).values({
      workspaceId: seed.workspaceId,
      contactId: seed.contactId,
      categoryId: "product",
      score: 10,
      updatedAt: "now",
    });
  }
  const job = (await engine.findJobForProcessing(seed.jobId, "lease"))!;
  for (let retry = 0; retry < 2; retry++)
    await executeNode(
      node,
      definition,
      job,
      "lease",
      runtimeWithJobsQueue(queueStub()),
      db,
      new AutomationDecisionRepository(db),
      new AutomationContactActionRepository(db),
    );
  const contact = await db.orm
    .select({ score: contacts.score })
    .from(contacts)
    .where(eq(contacts.id, seed.contactId))
    .get();
  expect(contact?.score).toBe(category ? 20 : 7);
  expect(
    (
      await db.orm
        .select({ score: contactCategoryScores.score })
        .from(contactCategoryScores)
        .where(eq(contactCategoryScores.contactId, seed.contactId))
        .get()
    )?.score,
  ).toBe(category ? 7 : undefined);
});
