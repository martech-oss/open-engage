import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: database-entrypoints", [
  {
    name: "rejects the database root barrel in production",
    files: { "apps/server/src/contacts/service.ts": 'import "@openengage/database";\n' },
    want: "database package root",
  },
  {
    name: "rejects the testing entrypoint in production",
    files: { "apps/server/src/contacts/service.ts": 'import "@openengage/database/testing";\n' },
    want: "database testing entrypoint",
  },
  {
    name: "rejects schema and orm outside the exact Better Auth adapter",
    files: {
      "apps/server/src/auth/helper.ts":
        'import { createDatabase } from "@openengage/database/client";\n' +
        'import "@openengage/database/schema";\ncreateDatabase({}).orm;\n',
    },
    want: "Better Auth adapter",
  },
  {
    name: "allows schema and orm in the exact Better Auth adapter",
    files: {
      "apps/server/src/auth/service.ts":
        'import { createDatabase } from "@openengage/database/client";\n' +
        'import { authSchema } from "@openengage/database/schema";\n' +
        "const database = createDatabase({});\n" +
        "export const auth = database.orm;\n" +
        'export const quotedAuth = database["orm"];\n' +
        "export const templateAuth = database[`orm`];\n" +
        "export const { orm: destructuredAuth } = database;\n" +
        "void authSchema;\n",
    },
  },
  {
    name: "rejects a relative server import that resolves to the database schema",
    files: {
      "apps/server/src/contacts/service.ts": 'import "../../../../packages/database/src/schema";\n',
      "packages/database/src/schema.ts": "export const schema = {};\n",
    },
    want: "Better Auth adapter",
  },
  {
    name: "rejects an external relative import of a physical owner schema",
    files: {
      "apps/server/src/contacts/service.ts":
        'import "../../../../packages/database/src/contacts/schema";\n',
      "packages/database/src/contacts/schema.ts": "export const contacts = {};\n",
    },
    want: "raw owner schema",
  },
  {
    name: "rejects a physical owner schema even in the Better Auth adapter",
    files: {
      "apps/server/src/auth/service.ts":
        'import "../../../../packages/database/src/auth/schema";\n',
      "packages/database/src/auth/schema.ts": "export const authSchema = {};\n",
    },
    want: "raw owner schema",
  },
  {
    name: "allows database internals to import their physical owner schema",
    files: {
      "packages/database/src/contacts/repository.ts":
        'import { contacts } from "./schema";\nvoid contacts;\n',
      "packages/database/src/contacts/schema.ts": "export const contacts = {};\n",
    },
  },
  {
    name: "allows the database client to assemble the schema internally",
    files: {
      "packages/database/src/client.ts": 'import { schema } from "./schema";\nvoid schema;\n',
      "packages/database/src/schema.ts": "export const schema = {};\n",
    },
  },
  {
    name: "rejects a quoted database orm element access outside auth",
    files: {
      "apps/server/src/contacts/service.ts":
        'declare const database: unknown;\nvoid database["orm"];\n',
    },
    want: "Better Auth adapter",
  },
  {
    name: "rejects a static template database orm element access outside auth",
    files: {
      "apps/server/src/contacts/service.ts":
        "declare const database: unknown;\nvoid database[`orm`];\n",
    },
    want: "Better Auth adapter",
  },
  {
    name: "rejects a parenthesized database orm element access outside auth",
    files: {
      "apps/server/src/contacts/service.ts":
        'declare const database: unknown;\nvoid database[("orm")];\n',
    },
    want: "Better Auth adapter",
  },
  {
    name: "rejects shorthand database orm destructuring outside auth",
    files: {
      "apps/server/src/contacts/service.ts":
        "declare const database: unknown;\nconst { orm } = database;\nvoid orm;\n",
    },
    want: "Better Auth adapter",
  },
  {
    name: "rejects aliased database orm destructuring outside auth",
    files: {
      "apps/server/src/contacts/service.ts":
        "declare const database: unknown;\nconst { orm: adapter } = database;\nvoid adapter;\n",
    },
    want: "Better Auth adapter",
  },
  {
    name: "rejects aliased orm assignment destructuring outside auth",
    files: {
      "apps/server/src/contacts/service.ts":
        "declare const database: unknown;\n" +
        "let adapter;\n({ orm: adapter } = database);\nvoid adapter;\n",
    },
    want: "Better Auth adapter",
  },
  {
    name: "rejects shorthand orm assignment destructuring outside auth",
    files: {
      "apps/server/src/contacts/service.ts":
        "declare const database: unknown;\nlet orm;\n({ orm } = database);\nvoid orm;\n",
    },
    want: "Better Auth adapter",
  },
  {
    name: "allows orm assignment destructuring in the exact Better Auth adapter",
    files: {
      "apps/server/src/auth/service.ts":
        "declare const database: unknown;\n" +
        "let adapter;\nlet orm;\n" +
        "({ orm: adapter } = database);\n({ orm } = database);\n" +
        "void adapter;\nvoid orm;\n",
    },
  },
]);
