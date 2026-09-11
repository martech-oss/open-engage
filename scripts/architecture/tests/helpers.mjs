import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const checker = resolve(import.meta.dirname, "../../check-architecture.mjs");

export async function fixture(files) {
  const root = await mkdtemp(resolve(tmpdir(), "openengage-architecture-"));
  await mkdir(resolve(root, "apps"), { recursive: true });
  await mkdir(resolve(root, "packages"), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

export async function run(root) {
  try {
    const result = await execFileAsync(process.execPath, [checker, "--root", root]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

export function sourceLines(count) {
  return [
    "export {};",
    ...Array.from({ length: count - 1 }, (_, index) => `// line ${index + 2}`),
  ].join("\n");
}

export function componentLines(count) {
  return [
    "export const Fixture = () => {",
    ...Array.from({ length: count - 3 }, () => "  void 0;"),
    "  return null;",
    "};",
  ].join("\n");
}

export function classMemberLines(signature, count) {
  return [
    "export class Fixture {",
    `  ${signature} {`,
    ...Array.from({ length: count - 2 }, () => "    void 0;"),
    "  }",
    "}",
  ].join("\n");
}

export function nestedParentheses(expression, depth) {
  return `${"(".repeat(depth)}${expression}${")".repeat(depth)}`;
}

export async function runScenarios(name, scenarios) {
  await test(name, async (t) => {
    for (const scenario of scenarios) {
      await t.test(scenario.name, async () => {
        const root = await fixture(scenario.files);
        try {
          const result = await run(root);
          if (scenario.want) {
            assert.notEqual(result.code, 0, `${result.stdout}\n${result.stderr}`);
            assert.match(result.stderr, new RegExp(scenario.want));
          } else {
            assert.equal(result.code, 0, result.stderr);
          }
          if (scenario.avoid) assert.doesNotMatch(result.stderr, new RegExp(scenario.avoid));
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  });
}
