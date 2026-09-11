import {
  SyntaxKind,
  isArrayLiteralExpression,
  isBinaryExpression,
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isNamespaceImport,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
} from "typescript/unstable/ast";

import { staticString, unwrapTransparentExpression, staticPropertyName } from "./syntax-utils.mjs";

export function collectRuntimeImportBindings(sourceFile, lexicalModel) {
  const importsByBinding = new Map();
  function record(identifier, metadata) {
    const binding = lexicalModel.resolveIdentifier(identifier);
    if (!binding) return;
    const imports = importsByBinding.get(binding) ?? [];
    imports.push(metadata);
    importsByBinding.set(binding, imports);
  }
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || !statement.importClause) continue;
    const specifier = staticString(statement.moduleSpecifier);
    if (specifier === undefined) continue;
    const clause = statement.importClause;
    if (clause.name && !clause.isTypeOnly) {
      record(clause.name, { importedName: "default", namespace: false, specifier });
    }
    const bindings = clause.namedBindings;
    if (bindings && isNamespaceImport(bindings) && !clause.isTypeOnly) {
      record(bindings.name, { importedName: "*", namespace: true, specifier });
    } else if (bindings && isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (clause.isTypeOnly || element.isTypeOnly) continue;
        record(element.name, {
          importedName: (element.propertyName ?? element.name).text,
          namespace: false,
          specifier,
        });
      }
    }
  }
  return importsByBinding;
}

export function isRpcTransportSetup(node, lexicalModel, runtimeImports) {
  const callee = unwrapTransparentExpression(node.expression);
  let records = [];
  let importedName;
  if (isIdentifier(callee)) {
    const binding = lexicalModel.resolveIdentifier(callee);
    records = binding ? (runtimeImports.get(binding) ?? []) : [];
    importedName = records[0]?.importedName;
  } else if (isPropertyAccessExpression(callee) && isIdentifier(callee.expression)) {
    const binding = lexicalModel.resolveIdentifier(callee.expression);
    records = binding
      ? (runtimeImports.get(binding) ?? []).filter((record) => record.namespace)
      : [];
    importedName = callee.name.text;
  }
  return records.some(({ specifier }) => {
    if (isNewExpression(node)) {
      return specifier === "@orpc/client/fetch" && importedName === "RPCLink";
    }
    return (
      (specifier === "@orpc/client" && importedName === "createORPCClient") ||
      (specifier === "@orpc/tanstack-query" && importedName === "createTanstackQueryUtils")
    );
  });
}

export function objectContainsDisabledSsr(node, lexicalModel, seenBindings = new Set()) {
  const target = unwrapTransparentExpression(node);
  if (isIdentifier(target)) {
    const binding = lexicalModel.resolveIdentifier(target);
    if (!binding || seenBindings.has(binding)) return false;
    const nestedSeen = new Set(seenBindings);
    nestedSeen.add(binding);
    return binding.definitions.some(
      (definition) =>
        definition.kind === "expression" &&
        objectContainsDisabledSsr(definition.node, lexicalModel, nestedSeen),
    );
  }
  if (!isObjectLiteralExpression(target)) return false;
  return target.properties.some((property) => {
    if (isPropertyAssignment(property) && staticPropertyName(property.name) === "ssr") {
      return expressionResolvesFalse(property.initializer, lexicalModel);
    }
    if (isShorthandPropertyAssignment(property) && property.name.text === "ssr") {
      return expressionResolvesFalse(property.name, lexicalModel);
    }
    return (
      isSpreadAssignment(property) &&
      objectContainsDisabledSsr(property.expression, lexicalModel, seenBindings)
    );
  });
}

function expressionResolvesFalse(node, lexicalModel, seenBindings = new Set()) {
  const target = unwrapTransparentExpression(node);
  if (target.kind === SyntaxKind.FalseKeyword) return true;
  if (!isIdentifier(target)) return false;
  const binding = lexicalModel.resolveIdentifier(target);
  if (!binding || seenBindings.has(binding)) return false;
  const nestedSeen = new Set(seenBindings);
  nestedSeen.add(binding);
  return binding.definitions.some(
    (definition) =>
      definition.kind === "expression" &&
      expressionResolvesFalse(definition.node, lexicalModel, nestedSeen),
  );
}

export function isDirectRolePermissionExpression(node, lexicalModel) {
  if (isNewExpression(node) && isRolePermissionCollection(node, lexicalModel)) return true;
  if (
    isBinaryExpression(node) &&
    [
      SyntaxKind.EqualsEqualsToken,
      SyntaxKind.EqualsEqualsEqualsToken,
      SyntaxKind.ExclamationEqualsToken,
      SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(node.operatorToken.kind)
  ) {
    return (
      (isRoleReference(node.left, lexicalModel) && isWorkspaceRoleLiteral(node.right)) ||
      (isRoleReference(node.right, lexicalModel) && isWorkspaceRoleLiteral(node.left))
    );
  }
  if (
    isCallExpression(node) &&
    isPropertyAccessExpression(unwrapTransparentExpression(node.expression))
  ) {
    const callee = unwrapTransparentExpression(node.expression);
    if (
      (callee.name.text === "includes" || callee.name.text === "has") &&
      node.arguments.some((argument) => isRoleReference(argument, lexicalModel)) &&
      isRolePermissionCollection(callee.expression, lexicalModel)
    ) {
      return true;
    }
  }
  return false;
}

function isRoleReference(node, lexicalModel, seenBindings = new Set()) {
  const target = unwrapTransparentExpression(node);
  if (
    (isIdentifier(target) && /role$/i.test(target.text)) ||
    (isPropertyAccessExpression(target) && target.name.text === "role") ||
    (isElementAccessExpression(target) && staticString(target.argumentExpression) === "role")
  ) {
    return true;
  }
  if (!isIdentifier(target)) return false;
  const binding = lexicalModel.resolveIdentifier(target);
  if (!binding || seenBindings.has(binding)) return false;
  const nestedSeen = new Set(seenBindings);
  nestedSeen.add(binding);
  return binding.definitions.some((definition) => {
    if (
      definition.kind === "projection" &&
      definition.path.some((step) => step.kind === "object" && step.key === "role")
    ) {
      return true;
    }
    return (
      definition.kind === "expression" && isRoleReference(definition.node, lexicalModel, nestedSeen)
    );
  });
}

function isWorkspaceRoleLiteral(node) {
  // Keep this permission ratchet synchronized with WORKSPACE_ROLES in
  // packages/core/src/shared/schema.ts.
  return ["owner", "admin", "marketer", "analyst", "viewer"].includes(staticString(node));
}

function isRolePermissionCollection(node, lexicalModel, seenBindings = new Set()) {
  const target = unwrapTransparentExpression(node);
  if (isArrayLiteralExpression(target)) {
    return target.elements.some(isWorkspaceRoleLiteral);
  }
  if (
    isNewExpression(target) &&
    isIdentifier(target.expression) &&
    target.expression.text === "Set"
  ) {
    return (
      target.arguments?.some((argument) =>
        isRolePermissionCollection(argument, lexicalModel, seenBindings),
      ) ?? false
    );
  }
  if (!isIdentifier(target)) return false;
  if (/(?:role|permission)/i.test(target.text)) return true;
  const binding = lexicalModel.resolveIdentifier(target);
  if (!binding || seenBindings.has(binding)) return false;
  const nestedSeen = new Set(seenBindings);
  nestedSeen.add(binding);
  return binding.definitions.some(
    (definition) =>
      definition.kind === "expression" &&
      isRolePermissionCollection(definition.node, lexicalModel, nestedSeen),
  );
}
