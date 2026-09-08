import { env, exports } from "cloudflare:workers";

import { ProjectCloneRepository } from "@openengage/database/projects";

import type { seedWorkspaceClient } from "./factory";

export type CloneFixture = Awaited<ReturnType<typeof seedWorkspaceClient>>;
export const cloneOptions = {
  name: "Copy",
  ownerUserId: null,
  approverUserId: null,
  reviewAt: null,
  variables: {},
};

export async function finishClone(fixture: CloneFixture, id: string, jobId: string) {
  await fixture.client.projects.cloneStart({ id, jobId, requestKey: jobId });
  const repository = new ProjectCloneRepository(env.DB, fixture);
  for (let step = 0; step < 30; step++) {
    if ((await repository.process(jobId, 20)) === "completed") return;
  }
  throw new Error("Clone did not finish");
}

export const postCloneForm = (path: string, body: unknown) =>
  exports.default.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify(body),
    }),
  );
