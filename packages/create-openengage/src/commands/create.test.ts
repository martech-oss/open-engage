import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelValue: Symbol("cancel"),
  confirm: vi.fn<(options: unknown) => Promise<boolean | symbol>>(),
  execa:
    vi.fn<
      (
        file: string,
        args: string[],
        options?: Record<string, unknown>,
      ) => Promise<{ stdout: string }>
    >(),
  password: vi.fn<(options: unknown) => Promise<string | symbol>>(),
  text: vi.fn<(options: unknown) => Promise<string | symbol>>(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: mocks.confirm,
  isCancel: (value: unknown) => value === mocks.cancelValue,
  note: vi.fn<(...args: unknown[]) => void>(),
  outro: vi.fn<(...args: unknown[]) => void>(),
  password: mocks.password,
  spinner: () => ({
    start: vi.fn<(...args: unknown[]) => void>(),
    stop: vi.fn<(...args: unknown[]) => void>(),
  }),
  text: mocks.text,
}));

vi.mock("execa", () => ({ execa: mocks.execa }));
vi.mock("../shared", () => ({
  abort: () => {
    throw new Error("cancelled");
  },
}));

import { runCreateCommand } from "./create";

let projectDirectory: string;

beforeEach(async () => {
  vi.clearAllMocks();
  projectDirectory = await mkdtemp(resolve(tmpdir(), "create-openengage-turnstile-"));
  await mkdir(resolve(projectDirectory, "apps/server"), { recursive: true });
  await writeFile(resolve(projectDirectory, "apps/server/wrangler.jsonc"), "{}");
});

afterEach(async () => {
  await rm(projectDirectory, { recursive: true, force: true });
});

describe("create command provisioning prompts", () => {
  it("catches creating Cloudflare resources before a cancelled Turnstile site-key prompt", async () => {
    mocks.text
      .mockResolvedValueOnce(projectDirectory)
      .mockResolvedValueOnce("https://ma.example.com")
      .mockResolvedValueOnce("mail.example.com")
      .mockResolvedValueOnce("notifications@mail.example.com")
      .mockResolvedValueOnce("Example Engage")
      .mockResolvedValueOnce(mocks.cancelValue);
    mocks.confirm.mockResolvedValue(true);
    mocks.execa.mockImplementation(async (_file: string, args: string[]) => ({
      stdout: args.includes("d1") && args.includes("create") ? '{"uuid":"database-id"}' : "",
    }));

    await expect(runCreateCommand()).rejects.toThrow("cancelled");

    const cloudflareMutations = mocks.execa.mock.calls.filter((call) => {
      const args = call[1] as string[];
      return ["email", "d1", "r2", "queues"].some((command) => args.includes(command));
    });
    expect(cloudflareMutations).toEqual([]);
  });
});
