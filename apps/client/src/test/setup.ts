import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library cannot register its own cleanup:
// unmount whatever each test rendered here instead of in every DOM test file.
afterEach(cleanup);
