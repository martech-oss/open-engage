import { execa } from "execa";

import { createCommandRunner } from "./command-runner";

export const commandRunner = createCommandRunner(async (file, args, { cwd }) => {
  const result = await execa(file, args, { cwd });
  return { stdout: result.stdout };
});
