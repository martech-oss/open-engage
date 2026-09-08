import * as agentsSchema from "./agents/schema";
import * as assetsSchema from "./assets/schema";
import { authSchema } from "./auth/schema";
import * as automationsSchema from "./automations/schema";
import * as consentSchema from "./consent/schema";
import * as lifecycleSchema from "./contacts/lifecycle-schema";
import * as contactsSchema from "./contacts/schema";
import * as visitorSchema from "./contacts/visitor-schema";
import * as dealsSchema from "./deals/schema";
import * as messagingSchema from "./messaging/schema";
import * as platformSchema from "./platform/schema";
import * as projectCloneSchema from "./projects/clone-schema";
import * as formProgramSchema from "./projects/form-program-schema";
import * as projectProgramSchema from "./projects/program-schema";
import * as projectsSchema from "./projects/schema";
import * as projectVariableSchema from "./projects/variable-schema";
import * as relationsSchema from "./relations";
import * as reportsSchema from "./reports/schema";
import * as scoringSchema from "./scoring/schema";
import * as segmentsSchema from "./segments/schema";
import * as optimizationSchema from "./web/optimization-schema";
import * as webSchema from "./web/schema";
import * as workspacesSchema from "./workspaces/schema";

export * from "./agents/schema";
export * from "./assets/schema";
export * from "./auth/schema";
export * from "./contacts/schema";
export * from "./contacts/visitor-schema";
export * from "./contacts/lifecycle-schema";
export * from "./segments/schema";
export * from "./deals/schema";
export * from "./consent/schema";
export * from "./automations/schema";
export * from "./messaging/schema";
export * from "./web/schema";
export * from "./web/optimization-schema";
export * from "./workspaces/schema";
export * from "./platform/schema";
export * from "./projects/schema";
export * from "./projects/clone-schema";
export * from "./projects/program-schema";
export * from "./projects/variable-schema";
export * from "./projects/form-program-schema";
export * from "./reports/schema";
export * from "./scoring/schema";

/**
 * Every table in the application, keyed by export name, for `drizzle()`
 * registration - plus every `relations()` definition (see relations.ts),
 * which `drizzle()` needs in the same object to enable `db.query.*`.
 */
export const schema = {
  ...agentsSchema,
  ...assetsSchema,
  ...authSchema,
  ...contactsSchema,
  ...visitorSchema,
  ...lifecycleSchema,
  ...segmentsSchema,
  ...dealsSchema,
  ...consentSchema,
  ...automationsSchema,
  ...messagingSchema,
  ...webSchema,
  ...optimizationSchema,
  ...workspacesSchema,
  ...platformSchema,
  ...projectsSchema,
  ...projectCloneSchema,
  ...projectProgramSchema,
  ...projectVariableSchema,
  ...formProgramSchema,
  ...reportsSchema,
  ...scoringSchema,
  ...relationsSchema,
};
