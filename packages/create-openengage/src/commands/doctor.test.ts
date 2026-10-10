import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandCheck } from "../command-runner";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn<() => Promise<string>>(),
  note: vi.fn<(...args: unknown[]) => void>(),
  outro: vi.fn<(...args: unknown[]) => void>(),
  check: vi.fn<(name: string) => Promise<CommandCheck>>(),
  outputIncludes: vi.fn<(name: string) => Promise<CommandCheck>>(),
  inspect: vi.fn<(name: string) => Promise<CommandCheck>>(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@clack/prompts", () => ({ note: mocks.note, outro: mocks.outro }));
vi.mock("../command-runner", () => ({
  commandRunner: {
    check: mocks.check,
    outputIncludes: mocks.outputIncludes,
    inspect: mocks.inspect,
  },
}));

import { runDoctorCommand } from "./doctor";

function serverConfig(setting: string, extra = ""): string {
  return `{
    ${extra}
    "vars": {${setting}, "TRANSACTIONAL_FROM_EMAIL": "notifications@example.com"},
    "d1_databases": [{"database_id": "database-id"}],
    "send_email": [{"name": "EMAIL", "allowed_sender_addresses": ["notifications@example.com"]}]
  }`;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [mocks.check, mocks.outputIncludes, mocks.inspect]) {
    mock.mockImplementation(async (name) => ({ name, ok: true, detail: "ok" }));
  }
});

describe("doctor production authentication check", () => {
  it.each([
    ["ordinary development", serverConfig('"ENVIRONMENT": "development"')],
    ["whitespace", serverConfig('"ENVIRONMENT"\n:\t"development"')],
    ["comments", serverConfig('"ENVIRONMENT" /* key */ : /* value */ "development"')],
    ["escaped key", serverConfig(String.raw`"\u0045NVIRONMENT": "development"`)],
    ["escaped value", serverConfig(String.raw`"ENVIRONMENT": "develo\u0070ment"`)],
    [
      "duplicate environment keys ending in development",
      serverConfig('"ENVIRONMENT": "production", "ENVIRONMENT": "development"'),
    ],
    [
      "duplicate root vars ending in development",
      serverConfig('"ENVIRONMENT": "development"', '"vars": {"ENVIRONMENT": "production"},'),
    ],
    [
      "escaped root vars key",
      serverConfig('"ENVIRONMENT": "development"').replace('"vars"', String.raw`"\u0076ars"`),
    ],
  ])("rejects %s", async (_name, config) => {
    mocks.readFile.mockResolvedValue(config);

    await expect(runDoctorCommand()).rejects.toThrow("Doctor found configuration problems");

    expect(mocks.note).toHaveBeenCalledWith(
      expect.stringContaining(
        "Production authentication: ENVIRONMENT=development disables authentication protections; set production in apps/server/wrangler.jsonc",
      ),
      "Doctor report",
    );
    expect(mocks.outro).not.toHaveBeenCalled();
  });

  it.each([
    ["production", serverConfig('"ENVIRONMENT": "production"')],
    [
      "duplicate environment keys ending in production",
      serverConfig('"ENVIRONMENT": "development", "ENVIRONMENT": "production"'),
    ],
    [
      "duplicate root vars ending in production",
      serverConfig('"ENVIRONMENT": "production"', '"vars": {"ENVIRONMENT": "development"},'),
    ],
    [
      "unrelated strings, comments, and nested development bindings",
      serverConfig(
        String.raw`"ENVIRONMENT": "production", "NOTE": "\"ENVIRONMENT\": \"development\""`,
        `// "ENVIRONMENT": "development" is documentation.
        "ENVIRONMENT": "development",
        "env": {"preview": {"vars": {"ENVIRONMENT": "development"}}},
        "metadata": {"vars": {"ENVIRONMENT": "development"}},`,
      ),
    ],
    ["missing environment uses secure defaults", serverConfig('"APP_NAME": "Custom app"')],
  ])("accepts %s when the existing checks pass", async (_name, config) => {
    mocks.readFile.mockResolvedValue(config);

    await expect(runDoctorCommand()).resolves.toBeUndefined();

    expect(mocks.note).toHaveBeenCalledWith(
      expect.stringContaining("Production authentication: configured"),
      "Doctor report",
    );
    expect(mocks.outro).toHaveBeenCalledWith("All mandatory checks passed");
  });

  it.each([
    ["invalid JSONC", '{"vars": {"ENVIRONMENT": "development"}'],
    ["non-object root", "[]"],
    ["null root", "null"],
    ["non-object vars", '{"vars": []}'],
    ["null vars", '{"vars": null}'],
    ["non-string environment", '{"vars": {"ENVIRONMENT": false}}'],
  ])("rejects %s before running external checks", async (_name, config) => {
    mocks.readFile.mockResolvedValue(config);

    await expect(runDoctorCommand()).rejects.toThrow();

    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.outputIncludes).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.outro).not.toHaveBeenCalled();
  });
});
