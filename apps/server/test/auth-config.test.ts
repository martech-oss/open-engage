import { describe, expect, it } from "vitest";

import {
  isEmailVerificationRequired,
  isLocalDevelopment,
  resolveAuthBaseURL,
} from "../src/auth/service";

describe("Better Auth configuration", () => {
  it("uses the actual localhost port for Better Auth during development", () => {
    expect(
      resolveAuthBaseURL(
        { APP_URL: "http://localhost:8787", ENVIRONMENT: "development" },
        "http://localhost:8788",
      ),
    ).toBe("http://localhost:8788");
    expect(
      resolveAuthBaseURL(
        { APP_URL: "https://app.example.com", ENVIRONMENT: "production" },
        "https://evil.example.com",
      ),
    ).toBe("https://app.example.com");
  });

  it("skips email verification only in development", () => {
    const local = "http://localhost:5173";
    expect(isEmailVerificationRequired({ APP_URL: local, ENVIRONMENT: "development" })).toBe(false);
    expect(isEmailVerificationRequired({ APP_URL: local, ENVIRONMENT: "test" })).toBe(true);
    expect(isEmailVerificationRequired({ APP_URL: local, ENVIRONMENT: "production" })).toBe(true);
  });

  it("keeps production auth for a deployed Worker left in development mode", () => {
    const deployed = { APP_URL: "https://app.example.com", ENVIRONMENT: "development" };
    expect(isLocalDevelopment(deployed)).toBe(false);
    expect(isEmailVerificationRequired(deployed)).toBe(true);
    expect(resolveAuthBaseURL(deployed, "http://localhost:8788")).toBe("https://app.example.com");
    expect(
      isLocalDevelopment({ APP_URL: "http://127.0.0.1:5173", ENVIRONMENT: "development" }),
    ).toBe(true);
    expect(
      isLocalDevelopment({ APP_URL: "http://localhost.example.com", ENVIRONMENT: "development" }),
    ).toBe(false);
  });
});
