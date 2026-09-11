import { SyntaxKind, isIdentifier, isPropertyAccessExpression } from "typescript/unstable/ast";

import { enclosingCallable, unwrapTransparentExpression } from "../syntax-utils.mjs";

export function createContext(parent) {
  return {
    activeCallables: parent?.activeCallables ?? new Set(),
    activeClasses: parent?.activeClasses ?? new Set(),
    activeMemberClasses: parent?.activeMemberClasses ?? new Map(),
    cache: new Map(),
    classInstanceContexts: parent?.classInstanceContexts ?? new Map(),
    overrides: new Map(parent?.overrides ?? []),
    sourceOverrides: new Map(parent?.sourceOverrides ?? []),
    resolving: new Map(),
    resolvingDefinedness: new Map(),
  };
}

export function referencePosition(reference) {
  return reference?.pos ?? Number.POSITIVE_INFINITY;
}

export function effectiveDefinitions(binding, reference) {
  const position = referencePosition(reference);
  const referenceCallable = reference ? enclosingCallable(reference) : undefined;
  const groups = new Map();
  for (const definition of binding.definitions) {
    const definitionPosition = definition.position ?? Number.NEGATIVE_INFINITY;
    const sameExecution = definition.ownerCallable === referenceCallable;
    if (reference && sameExecution && definitionPosition > position) continue;
    const definitions = groups.get(definition.ownerCallable) ?? [];
    definitions.push(definition);
    groups.set(definition.ownerCallable, definitions);
  }
  const effective = [];
  for (const definitions of groups.values()) {
    let groupValues = [];
    for (const definition of definitions.sort(
      (left, right) =>
        (left.position ?? Number.NEGATIVE_INFINITY) - (right.position ?? Number.NEGATIVE_INFINITY),
    )) {
      if (definition.write === "replace") groupValues = [definition];
      else groupValues.push(definition);
    }
    effective.push(...groupValues);
  }
  return effective;
}

export function valueFact(provenance = new Set(), definedness = "unknown") {
  return { definedness, provenance };
}

export function joinDefinedness(values) {
  const known = new Set(values);
  if (known.size === 1) return values[0];
  return "unknown";
}

export function mergeFacts(facts, definedness) {
  const provenance = new Set();
  for (const fact of facts) addProvenance(provenance, fact.provenance);
  return valueFact(
    provenance,
    definedness ??
      (facts.length > 0 ? joinDefinedness(facts.map((fact) => fact.definedness)) : "unknown"),
  );
}

export function enqueueExpressions(target, expressions) {
  for (const expression of expressions) {
    if (expression) target.push(expression);
  }
}

export function isKnownPrimitiveSanitizer(node) {
  node = unwrapTransparentExpression(node);
  return (
    isIdentifier(node) && ["BigInt", "Boolean", "Number", "String", "Symbol"].includes(node.text)
  );
}

export function isTransparentValueCall(node) {
  node = unwrapTransparentExpression(node);
  if (isIdentifier(node)) return node.text === "structuredClone";
  if (!isPropertyAccessExpression(node) || !isIdentifier(node.expression)) return false;
  const transparentMethods = new Map([
    ["Array", new Set(["from"])],
    ["Object", new Set(["assign", "freeze", "preventExtensions", "seal"])],
    ["Promise", new Set(["resolve"])],
  ]);
  return transparentMethods.get(node.expression.text)?.has(node.name.text) ?? false;
}

export function binaryOperatorCanReturnOperand(kind) {
  return [
    SyntaxKind.AmpersandAmpersandToken,
    SyntaxKind.BarBarToken,
    SyntaxKind.QuestionQuestionToken,
    SyntaxKind.CommaToken,
    SyntaxKind.EqualsToken,
  ].includes(kind);
}

export function addProvenance(target, source) {
  for (const specifier of source) target.add(specifier);
}
