import {
  SyntaxKind,
  isBinaryExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
} from "typescript/unstable/ast";

import {
  classMemberName,
  enclosingCallable,
  isFunctionNode,
  unwrapTransparentExpression,
} from "../syntax-utils.mjs";

export function assignmentWriteKind(kind) {
  if (kind === SyntaxKind.EqualsToken) return "replace";
  if (
    kind === SyntaxKind.QuestionQuestionEqualsToken ||
    kind === SyntaxKind.BarBarEqualsToken ||
    kind === SyntaxKind.AmpersandAmpersandEqualsToken
  ) {
    return "merge";
  }
  return undefined;
}

export function mutationIsConditional(node) {
  let current = node.parent;
  while (current) {
    if (isFunctionNode(current)) return false;
    if (
      [
        SyntaxKind.IfStatement,
        SyntaxKind.ConditionalExpression,
        SyntaxKind.SwitchStatement,
        SyntaxKind.CaseBlock,
        SyntaxKind.ForStatement,
        SyntaxKind.ForInStatement,
        SyntaxKind.ForOfStatement,
        SyntaxKind.WhileStatement,
        SyntaxKind.DoStatement,
        SyntaxKind.TryStatement,
        SyntaxKind.CatchClause,
      ].includes(current.kind)
    ) {
      return true;
    }
    if (
      isBinaryExpression(current) &&
      [
        SyntaxKind.AmpersandAmpersandToken,
        SyntaxKind.BarBarToken,
        SyntaxKind.QuestionQuestionToken,
      ].includes(current.operatorToken.kind)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export function objectMutationEntries(
  expression,
  reference,
  resolveIdentifier,
  seenBindings = new Set(),
) {
  const node = unwrapTransparentExpression(expression);
  if (isIdentifier(node)) {
    const binding = resolveIdentifier(node);
    if (!binding || seenBindings.has(binding)) return [];
    const nestedSeen = new Set(seenBindings);
    nestedSeen.add(binding);
    return effectiveLocalObjectDefinitions(binding, reference).flatMap((definition) =>
      objectMutationEntries(definition.node, reference, resolveIdentifier, nestedSeen).map(
        (entry) => ({
          ...entry,
          write: definition.write === "merge" ? "merge" : entry.write,
        }),
      ),
    );
  }
  if (!isObjectLiteralExpression(node)) return [];
  const entries = [];
  for (const property of node.properties) {
    if (isPropertyAssignment(property)) {
      const member = classMemberName(property.name);
      if (member !== undefined) entries.push({ member, node: property.initializer });
    } else if (isShorthandPropertyAssignment(property)) {
      entries.push({ member: property.name.text, node: property.name });
    } else if (isSpreadAssignment(property)) {
      entries.push(
        ...objectMutationEntries(property.expression, reference, resolveIdentifier, seenBindings),
      );
    }
  }
  return entries;
}

// Deliberate boundary: Object.assign analysis expands only local bindings that resolve to
// object literals. Custom helpers, computed sources, and arbitrary receivers stay outside this
// rule. Mutating a source object's field after its literal initialization is also not modeled,
// so a later safe field overwrite can remain conservatively tainted.
function effectiveLocalObjectDefinitions(binding, reference) {
  const referenceCallable = enclosingCallable(reference);
  const referencePosition = reference.pos;
  const moduleDefinitions = [];
  const callableDefinitions = [];
  for (const definition of binding.definitions) {
    if (definition.kind !== "expression") continue;
    const definitionPosition = definition.position ?? Number.NEGATIVE_INFINITY;
    if (definition.ownerCallable === undefined) {
      if (referenceCallable || definitionPosition <= referencePosition) {
        moduleDefinitions.push(definition);
      }
    } else if (
      definition.ownerCallable === referenceCallable &&
      definitionPosition <= referencePosition
    ) {
      callableDefinitions.push(definition);
    }
  }
  let effective = [];
  const byPosition = (left, right) =>
    (left.position ?? Number.NEGATIVE_INFINITY) - (right.position ?? Number.NEGATIVE_INFINITY);
  for (const definition of [
    ...moduleDefinitions.sort(byPosition),
    ...callableDefinitions.sort(byPosition),
  ]) {
    if (definition.write === "replace") effective = [definition];
    else effective.push(definition);
  }
  return effective;
}
