import { env } from "cloudflare:workers";

import { seedWorkspaceClient } from "./factory";

export async function programFixture() {
  const f = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Event" });
  const contact = await f.client.contacts.create({ email: `${crypto.randomUUID()}@example.com` });
  return { ...f, projectId: project.id, contactId: contact.id };
}
