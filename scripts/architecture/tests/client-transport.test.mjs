import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: client-transport", [
  {
    name: "rejects RPCLink transport setup outside the shared client module",
    files: {
      "apps/client/src/features/contacts/transport.ts":
        'import { RPCLink } from "@orpc/client/fetch";\nexport const link = new RPCLink({});\n',
    },
    want: "shared client oRPC module",
  },
  {
    name: "rejects aliased RPCLink transport setup outside the shared client module",
    files: {
      "apps/client/src/features/contacts/transport.ts":
        'import { RPCLink as Link } from "@orpc/client/fetch";\nexport const link = new Link({});\n',
    },
    want: "shared client oRPC module",
  },
  {
    name: "rejects namespace oRPC client setup outside the shared client module",
    files: {
      "apps/client/src/features/contacts/transport.ts":
        'import * as client from "@orpc/client";\nexport const rpc = client.createORPCClient({});\n',
    },
    want: "shared client oRPC module",
  },
  {
    name: "rejects aliased oRPC client setup outside the shared client module",
    files: {
      "apps/client/src/features/contacts/transport.ts":
        'import { createORPCClient as createClient } from "@orpc/client";\nexport const rpc = createClient({});\n',
    },
    want: "shared client oRPC module",
  },
  {
    name: "allows type-only RPCLink imports outside the shared client module",
    files: {
      "apps/client/src/features/contacts/transport.ts":
        'import type { RPCLink } from "@orpc/client/fetch";\nexport type ContactLink = RPCLink;\n',
    },
  },
  {
    name: "allows RPCLink transport setup in the shared client module",
    files: {
      "apps/client/src/lib/orpc.ts":
        'import { RPCLink } from "@orpc/client/fetch";\nexport const link = new RPCLink({});\n',
    },
  },
]);
