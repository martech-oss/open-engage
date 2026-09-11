// Keep the original test command as the entry point for every rule suite.
import "./architecture/tests/database-entrypoints.test.mjs";
import "./architecture/tests/command-routers.test.mjs";
import "./architecture/tests/domain-boundaries.test.mjs";
import "./architecture/tests/database-barrels-aliases.test.mjs";
import "./architecture/tests/database-barrels-callables.test.mjs";
import "./architecture/tests/database-barrels-destructuring.test.mjs";
import "./architecture/tests/database-barrels-mutations.test.mjs";
import "./architecture/tests/parser.test.mjs";
import "./architecture/tests/module-resolution.test.mjs";
import "./architecture/tests/client-ssr.test.mjs";
import "./architecture/tests/client-permissions.test.mjs";
import "./architecture/tests/client-transport.test.mjs";
import "./architecture/tests/size-limits.test.mjs";
import "./architecture/tests/reentrancy.test.mjs";
