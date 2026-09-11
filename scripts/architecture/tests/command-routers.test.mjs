import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: command-routers", [
  {
    name: "rejects runtime database imports in migrated command routers",
    files: {
      "apps/server/src/segments/router.ts":
        'import { SegmentRepository } from "@openengage/database/segments";\n' +
        "void SegmentRepository;\n",
    },
    want: "migrated command router.*runtime import @openengage/database",
  },
  {
    name: "rejects runtime database imports in the migrated automation router",
    files: {
      "apps/server/src/automations/router.ts":
        'import { AutomationRepository } from "@openengage/database/automations";\n' +
        "void AutomationRepository;\n",
    },
    want: "migrated command router.*runtime import @openengage/database",
  },
  {
    name: "allows database type imports in migrated command routers",
    files: {
      "apps/server/src/automations/router.ts":
        'import type { AutomationRepository } from "@openengage/database/automations";\n' +
        "export type Repository = AutomationRepository;\n",
    },
  },
  {
    name: "rejects an empty named runtime database import in a migrated command router",
    files: {
      "apps/server/src/automations/router.ts":
        'import {} from "@openengage/database/automations";\n',
    },
    want: "migrated command router.*runtime import @openengage/database",
  },
  {
    name: "rejects a named runtime database re-export in a migrated command router",
    files: {
      "apps/server/src/automations/router.ts":
        'export { AutomationRepository } from "@openengage/database/automations";\n',
    },
    want: "migrated command router.*runtime import @openengage/database",
  },
  {
    name: "rejects a star runtime database re-export in a migrated command router",
    files: {
      "apps/server/src/segments/router.ts": 'export * from "@openengage/database/segments";\n',
    },
    want: "migrated command router.*runtime import @openengage/database",
  },
  {
    name: "allows a database type re-export in a migrated command router",
    files: {
      "apps/server/src/automations/router.ts":
        'export type { AutomationRepository } from "@openengage/database/automations";\n',
    },
  },
  {
    name: "allows an inline database type re-export in a migrated command router",
    files: {
      "apps/server/src/segments/router.ts":
        'export { type SegmentRepository } from "@openengage/database/segments";\n',
    },
  },
  {
    name: "rejects runtime database imports in the migrated contacts command router",
    files: {
      "apps/server/src/contacts/router.ts":
        'import { ContactRepository } from "@openengage/database/contacts";\n' +
        "void ContactRepository;\n",
    },
    want: "migrated command router.*runtime import @openengage/database",
  },
  {
    name: "allows database type imports in the migrated contacts command router",
    files: {
      "apps/server/src/contacts/router.ts":
        'import type { ContactRepository } from "@openengage/database/contacts";\n' +
        "export type Repository = ContactRepository;\n",
    },
  },
]);
