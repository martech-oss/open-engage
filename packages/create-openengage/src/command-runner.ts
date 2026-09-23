import { execa } from "execa";

export interface CommandResult {
  stdout: string;
}

export type ExecuteCommand = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<CommandResult>;

export interface CommandCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function createCommandRunner(execute: ExecuteCommand) {
  async function inspect(
    name: string,
    file: string,
    args: string[],
    cwd: string,
    evaluate: (stdout: string) => Omit<CommandCheck, "name">,
  ): Promise<CommandCheck> {
    try {
      const result = await execute(file, args, { cwd });
      return { name, ...evaluate(result.stdout) };
    } catch (error) {
      return { name, ok: false, detail: firstErrorLine(error) };
    }
  }

  return {
    inspect,
    check(name: string, file: string, args: string[], cwd: string): Promise<CommandCheck> {
      return inspect(name, file, args, cwd, () => ({ ok: true, detail: "ok" }));
    },
    async outputIncludes(
      name: string,
      file: string,
      args: string[],
      cwd: string,
      expected: readonly string[],
    ): Promise<CommandCheck> {
      if (expected.length === 0 || expected.some((value) => !value)) {
        return { name, ok: false, detail: "resource is not configured" };
      }
      return inspect(name, file, args, cwd, (stdout) => {
        const missing = expected.filter((value) => !stdout.includes(value));
        return missing.length === 0
          ? { ok: true, detail: expected.join(", ") }
          : { ok: false, detail: `${missing.join(", ")} was not found` };
      });
    },
    async allowExisting(file: string, args: string[], cwd: string): Promise<void> {
      try {
        await execute(file, args, { cwd });
      } catch (error) {
        const detail = error instanceof Error ? error.message.toLowerCase() : String(error);
        if (!detail.includes("already exists")) throw error;
      }
    },
  };
}

export const commandRunner = createCommandRunner(async (file, args, { cwd }) => {
  const result = await execa(file, args, { cwd });
  return { stdout: result.stdout };
});

function firstErrorLine(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error);
}
