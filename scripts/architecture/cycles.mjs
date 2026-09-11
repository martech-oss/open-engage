import { relative } from "node:path";

export function checkDependencyCycles({ root, files, graph }) {
  const violations = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  for (const file of files) visit(file);
  function visit(file) {
    if (visited.has(file)) return;
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      const cycle = [...stack.slice(start), file].map((item) => relative(root, item)).join(" -> ");
      violations.push(`dependency cycle: ${cycle}`);
      return;
    }
    visiting.add(file);
    stack.push(file);
    for (const dependency of graph.get(file)) visit(dependency);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }
  return violations;
}
