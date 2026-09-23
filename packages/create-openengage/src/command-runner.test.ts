import { describe, expect, it, vi } from "vitest";

import { createCommandRunner, type ExecuteCommand } from "./command-runner";

describe("command runner", () => {
  it("parses successful and failed doctor checks without Cloudflare", async () => {
    const execute = vi
      .fn<ExecuteCommand>()
      .mockResolvedValueOnce({ stdout: "openengage-jobs" })
      .mockRejectedValueOnce(new Error("not authenticated\nstack"));
    const runner = createCommandRunner(execute);

    await expect(
      runner.outputIncludes("Queues", "pnpm", ["queues", "list"], "/project", ["openengage-jobs"]),
    ).resolves.toEqual({ name: "Queues", ok: true, detail: "openengage-jobs" });
    await expect(runner.check("Login", "pnpm", ["whoami"], "/project")).resolves.toEqual({
      name: "Login",
      ok: false,
      detail: "not authenticated",
    });
  });

  it("names every expected resource the command output is missing", async () => {
    const execute = vi.fn<ExecuteCommand>().mockResolvedValue({ stdout: "BETTER_AUTH_SECRET" });
    const runner = createCommandRunner(execute);

    await expect(
      runner.outputIncludes("Secrets", "pnpm", ["secret", "list"], "/project", [
        "BETTER_AUTH_SECRET",
        "CREDENTIAL_ENCRYPTION_KEY",
        "TRACKING_SIGNING_SECRET",
      ]),
    ).resolves.toEqual({
      name: "Secrets",
      ok: false,
      detail: "CREDENTIAL_ENCRYPTION_KEY, TRACKING_SIGNING_SECRET was not found",
    });
    await expect(
      runner.outputIncludes("R2", "pnpm", ["r2", "bucket", "list"], "/project", [""]),
    ).resolves.toEqual({ name: "R2", ok: false, detail: "resource is not configured" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("ignores only the expected already-exists provisioning error", async () => {
    const execute = vi.fn<ExecuteCommand>().mockRejectedValue(new Error("Queue already exists"));
    const runner = createCommandRunner(execute);

    await expect(runner.allowExisting("pnpm", ["queues", "create"], "/project")).resolves.toBe(
      undefined,
    );
  });
});
