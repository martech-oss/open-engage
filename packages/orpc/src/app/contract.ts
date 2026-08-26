import { oc } from "@orpc/contract";
import * as z from "zod";

import { workspaceSchema } from "@openengage/core/workspaces";

import { sessionErrors } from "../shared/errors";

export const appBootstrapSchema = z.object({
  viewer: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  workspace: workspaceSchema.nullable(),
  workspaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
    }),
  ),
});

export type AppBootstrap = z.infer<typeof appBootstrapSchema>;

export const appContract = {
  bootstrap: oc
    .route({ method: "GET", path: "/app/bootstrap" })
    .errors(sessionErrors)
    .output(appBootstrapSchema),
};
