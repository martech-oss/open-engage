import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: domain-boundaries", [
  ...["worker", "node-execution", "action-execution", "execution-dependencies"].map((module) => ({
    name: `rejects automation ${module} dependencies on runtime composition`,
    files: {
      [`apps/server/src/automations/${module}.ts`]:
        'import { createAutomationExecutionDependencies } from "../runtime/automation-execution";\n' +
        "void createAutomationExecutionDependencies;\n",
      "apps/server/src/runtime/automation-execution.ts":
        "export const createAutomationExecutionDependencies = () => undefined;\n",
    },
    want: "automations domain must not depend on runtime composition",
  })),
  {
    name: "allows runtime composition of automation execution modules",
    files: {
      "apps/server/src/automations/action-execution.ts":
        "export const executeAutomationAction = () => undefined;\n",
      "apps/server/src/runtime/automation-execution.ts":
        'import { executeAutomationAction } from "../automations/action-execution";\nvoid executeAutomationAction;\n',
    },
  },
  {
    name: "rejects contacts domain dependencies on runtime composition",
    files: {
      "apps/server/src/contacts/service.ts":
        'import { recordContactEvent } from "../runtime/contact-event-service";\n' +
        "void recordContactEvent;\n",
      "apps/server/src/runtime/contact-event-service.ts":
        "export const recordContactEvent = () => undefined;\n",
    },
    want: "contacts domain must not depend on runtime composition",
  },
  {
    name: "allows runtime composition to depend on the contacts domain",
    files: {
      "apps/server/src/contacts/event-service.ts":
        "export const ContactEventProcessor = class {};\n",
      "apps/server/src/runtime/contact-event-service.ts":
        'import { ContactEventProcessor } from "../contacts/event-service";\n' +
        "void ContactEventProcessor;\n",
    },
  },
  {
    name: "rejects platform to channels inversion",
    files: {
      "apps/server/src/platform/signatures.ts": 'import "../channels/index";\n',
      "apps/server/src/channels/index.ts": "export {};\n",
    },
    want: "platform must not import channels",
  },
  {
    name: "rejects rendering to public inversion",
    files: {
      "apps/server/src/rendering/html.ts": 'import "../public/http";\n',
      "apps/server/src/public/http.ts": "export {};\n",
    },
    want: "rendering must not import public",
  },
  {
    name: "rejects asset and project implementations left under web",
    files: {
      "packages/database/src/web/asset-repository.ts": "export {};\n",
      "apps/server/src/web/project-service.ts": "export {};\n",
    },
    want: "implementation must live in its owning domain",
  },
  {
    name: "rejects the former contacts score schema path",
    files: { "packages/database/src/contacts/score-schema.ts": "export {};\n" },
    want: "score events belong to scoring",
  },
  {
    name: "rejects references to the former contacts score schema path",
    files: {
      "packages/database/src/scoring/repository.ts":
        'import "../contacts/score-schema";\nexport {};\n',
    },
    want: "score events belong to scoring",
  },
  {
    name: "rejects schema or foreign ownership from a database domain barrel",
    files: {
      "packages/database/src/contacts/index.ts":
        'export * from "./schema";\nexport * from "../client";\n',
      "packages/database/src/contacts/schema.ts": "export {};\n",
      "packages/database/src/client.ts": "export {};\n",
    },
    want: "domain barrel",
  },
]);
