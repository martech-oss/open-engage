import {
  NodeFlags,
  SyntaxKind,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isCatchClause,
  isClassDeclaration,
  isClassExpression,
  isConditionalExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isExportAssignment,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isPropertyAccessExpression,
  isPrivateIdentifier,
  isThrowStatement,
  isVariableDeclaration,
  isVariableStatement,
} from "typescript/unstable/ast";

import {
  classMemberName,
  enclosingThisClass,
  enclosingCallable,
  isFunctionNode,
  staticString,
  unwrapTransparentExpression,
} from "../syntax-utils.mjs";
import { assignmentWriteKind, mutationIsConditional, objectMutationEntries } from "./mutations.mjs";
import { assignmentPatternLeaves, bindNameEntries, bindingPatternLeaves } from "./patterns.mjs";

export function createLexicalModel(sourceFile) {
  const rootScope = { bindings: new Map(), kind: "source", parent: undefined };
  const nodeScopes = new WeakMap();
  const scopesByRange = new Map();
  const declarationBindings = new WeakMap();
  const declarationBindingsByRange = new Map();
  const exportedBindings = new Set();
  const exportedDefinitions = [];
  const exportedExpressions = [];
  const exportedIdentifierNodes = [];
  const assignmentNodes = [];
  const mutationCallNodes = [];
  const classAssignments = new WeakMap();

  function nodeRangeKey(node) {
    return `${node.kind}:${node.pos}:${node.end}`;
  }

  function rememberScope(node, scope) {
    nodeScopes.set(node, scope);
    scopesByRange.set(nodeRangeKey(node), scope);
  }

  function createScope(parent, kind) {
    return { bindings: new Map(), kind, parent };
  }

  function bindIdentifier(identifier, scope, definition) {
    let binding = scope.bindings.get(identifier.text);
    if (!binding) {
      binding = { definitions: [], importSpecifiers: new Set(), name: identifier.text };
      scope.bindings.set(identifier.text, binding);
    }
    if (definition) binding.definitions.push(definition);
    declarationBindings.set(identifier, binding);
    declarationBindingsByRange.set(nodeRangeKey(identifier), binding);
    rememberScope(identifier, scope);
    return binding;
  }

  function projectedDefinition(definition, path) {
    if (!definition || path.length === 0) return definition;
    if (definition.kind === "expression") {
      return { ...definition, kind: "projection", path };
    }
    if (definition.kind === "expressions") {
      return { ...definition, kind: "projection-list", path };
    }
    return definition;
  }

  function bindName(name, scope, definition) {
    return bindingPatternLeaves(name).map(({ identifier, path }) => ({
      binding: bindIdentifier(identifier, scope, projectedDefinition(definition, path)),
      path,
    }));
  }

  function hasExportModifier(node) {
    return node.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false;
  }

  function visitFunction(node, outerScope) {
    let declarationBinding;
    if (isFunctionDeclaration(node) && node.name) {
      declarationBinding = bindName(node.name, outerScope, {
        kind: "function",
        node,
        ownerCallable: enclosingCallable(node),
        position: Number.NEGATIVE_INFINITY,
        write: "replace",
      })[0]?.binding;
    }
    if (isFunctionDeclaration(node) && node.parent === sourceFile && hasExportModifier(node)) {
      if (declarationBinding) exportedBindings.add(declarationBinding);
      else exportedDefinitions.push({ kind: "function", node });
    }

    const functionScope = createScope(outerScope, "function");
    if (isFunctionExpression(node) && node.name) {
      bindName(node.name, functionScope, {
        kind: "function",
        node,
        ownerCallable: node,
        position: Number.NEGATIVE_INFINITY,
        write: "replace",
      });
    }
    for (const parameter of node.parameters ?? []) {
      bindName(parameter.name, functionScope, { kind: "parameter", node: parameter });
    }
    for (const parameter of node.parameters ?? []) {
      if (parameter.initializer) visit(parameter.initializer, functionScope);
    }
    if (node.body) visit(node.body, functionScope);
  }

  function visitClass(node, outerScope) {
    let declarationBinding;
    if (isClassDeclaration(node) && node.name) {
      declarationBinding = bindName(node.name, outerScope, {
        kind: "class",
        node,
        ownerCallable: enclosingCallable(node),
        position: node.pos,
        write: "replace",
      })[0]?.binding;
    }
    if (isClassDeclaration(node) && node.parent === sourceFile && hasExportModifier(node)) {
      if (declarationBinding) exportedBindings.add(declarationBinding);
      else exportedDefinitions.push({ kind: "class", node });
    }

    const classScope = createScope(outerScope, "class");
    if (isClassExpression(node) && node.name) {
      bindName(node.name, classScope, {
        kind: "class",
        node,
        ownerCallable: enclosingCallable(node),
        position: node.pos,
        write: "replace",
      });
    }
    for (const clause of node.heritageClauses ?? []) visit(clause, classScope);
    for (const member of node.members) visit(member, classScope);
  }

  function visit(node, scope) {
    rememberScope(node, scope);

    if (isImportDeclaration(node)) {
      const specifier = staticString(node.moduleSpecifier);
      if (specifier !== undefined && node.importClause) {
        const importedNames = [];
        if (node.importClause.name) importedNames.push(node.importClause.name);
        const bindings = node.importClause.namedBindings;
        if (bindings && isNamespaceImport(bindings)) importedNames.push(bindings.name);
        else if (bindings && isNamedImports(bindings)) {
          for (const element of bindings.elements) importedNames.push(element.name);
        }
        for (const name of importedNames) {
          const binding = bindIdentifier(name, scope);
          binding.importSpecifiers.add(specifier);
        }
      }
      return;
    }
    if (isExportDeclaration(node)) {
      if (!node.moduleSpecifier && node.exportClause && isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const localName = element.propertyName ?? element.name;
          if (isIdentifier(localName)) exportedIdentifierNodes.push(localName);
        }
      }
      node.forEachChild((child) => visit(child, scope));
      return;
    }
    if (isExportAssignment(node)) {
      exportedExpressions.push(node.expression);
      visit(node.expression, scope);
      return;
    }
    if (isFunctionNode(node)) {
      visitFunction(node, scope);
      return;
    }
    if (isClassDeclaration(node) || isClassExpression(node)) {
      visitClass(node, scope);
      return;
    }
    if (isCatchClause(node)) {
      const catchScope = createScope(scope, "block");
      const thrownExpressions = collectThrownExpressions(node.parent?.tryBlock);
      if (node.variableDeclaration) {
        bindName(
          node.variableDeclaration.name,
          catchScope,
          thrownExpressions.length > 0
            ? {
                kind: "expressions",
                nodes: thrownExpressions,
                ownerCallable: enclosingCallable(node),
                position: node.pos,
                write: "merge",
              }
            : undefined,
        );
      }
      visit(node.block, catchScope);
      return;
    }
    if (isBlock(node)) {
      const blockScope = createScope(scope, "block");
      node.forEachChild((child) => visit(child, blockScope));
      return;
    }
    if (isVariableDeclaration(node)) {
      const definition = node.initializer
        ? {
            kind: "expression",
            node: node.initializer,
            ownerCallable: enclosingCallable(node),
            position: node.initializer.end,
            write: "replace",
          }
        : {
            kind: hasDeclareModifier(node) ? "unknown" : "undefined",
            node,
            ownerCallable: enclosingCallable(node),
            position: node.pos,
            write: "replace",
          };
      const declarationScope = isBlockScopedVariableDeclaration(node)
        ? scope
        : nearestVarScope(scope);
      const bindings = bindName(node.name, declarationScope, definition);
      const statement = node.parent?.parent;
      if (
        statement &&
        isVariableStatement(statement) &&
        statement.parent === sourceFile &&
        hasExportModifier(statement)
      ) {
        for (const { binding } of bindings) exportedBindings.add(binding);
      }
      if (node.initializer) visit(node.initializer, scope);
      return;
    }
    if (isBinaryExpression(node) && assignmentWriteKind(node.operatorToken.kind)) {
      assignmentNodes.push(node);
    }
    if (isCallExpression(node)) mutationCallNodes.push(node);
    node.forEachChild((child) => visit(child, scope));
  }

  function resolveIdentifier(identifier) {
    const declarationBinding =
      declarationBindings.get(identifier) ??
      declarationBindingsByRange.get(nodeRangeKey(identifier));
    if (declarationBinding) return declarationBinding;
    let scope =
      nodeScopes.get(identifier) ?? scopesByRange.get(nodeRangeKey(identifier)) ?? rootScope;
    while (scope) {
      const binding = scope.bindings.get(identifier.text);
      if (binding) return binding;
      scope = scope.parent;
    }
    return undefined;
  }

  visit(sourceFile, rootScope);
  for (const identifier of exportedIdentifierNodes) {
    const binding = resolveIdentifier(identifier);
    if (binding) exportedBindings.add(binding);
  }

  for (const assignment of assignmentNodes) {
    let write = assignmentWriteKind(assignment.operatorToken.kind);
    if (!write) continue;
    if (write === "replace" && mutationIsConditional(assignment)) write = "merge";
    for (const { identifier, path } of assignmentPatternLeaves(assignment.left)) {
      const binding = resolveIdentifier(identifier);
      if (!binding) continue;
      binding.definitions.push(
        projectedDefinition(
          {
            kind: "expression",
            node: assignment.right,
            ownerCallable: enclosingCallable(assignment),
            position: assignment.end,
            write,
          },
          path,
        ),
      );
    }
  }

  function classesForExpression(expression, seenBindings = new Set()) {
    const node = unwrapTransparentExpression(expression);
    if (isClassDeclaration(node) || isClassExpression(node)) return [node];
    if (isConditionalExpression(node)) {
      return [
        ...classesForExpression(node.whenTrue, seenBindings),
        ...classesForExpression(node.whenFalse, seenBindings),
      ];
    }
    if (!isIdentifier(node)) return [];
    const binding = resolveIdentifier(node);
    if (!binding || seenBindings.has(binding)) return [];
    seenBindings.add(binding);
    return binding.definitions.flatMap((definition) => {
      if (definition.kind === "class") return [definition.node];
      if (definition.kind === "expression") {
        return classesForExpression(definition.node, seenBindings);
      }
      return [];
    });
  }

  function classesForReceiver(receiver) {
    receiver = unwrapTransparentExpression(receiver);
    if (receiver.kind === SyntaxKind.ThisKeyword) {
      const owner = enclosingThisClass(receiver);
      return owner ? [owner] : [];
    }
    return classesForExpression(receiver);
  }

  function recordClassAssignment(owner, member, node, mutation, targetName, writeOverride) {
    let write = writeOverride ?? assignmentWriteKind(mutation.operatorToken?.kind) ?? "replace";
    if (write === "replace" && mutationIsConditional(mutation)) write = "merge";
    const records = classAssignments.get(owner) ?? [];
    records.push({
      member,
      node,
      ownerCallable: enclosingCallable(mutation, owner),
      position: mutation.end,
      private: targetName ? isPrivateIdentifier(targetName) : false,
      write,
    });
    classAssignments.set(owner, records);
  }

  for (const assignment of assignmentNodes) {
    const target = unwrapTransparentExpression(assignment.left);
    if (!isPropertyAccessExpression(target) && !isElementAccessExpression(target)) continue;
    const member = isPropertyAccessExpression(target)
      ? classMemberName(target.name)
      : staticString(target.argumentExpression);
    if (member === undefined) continue;
    const receiver = unwrapTransparentExpression(target.expression);
    for (const owner of classesForReceiver(receiver)) {
      recordClassAssignment(
        owner,
        member,
        assignment.right,
        assignment,
        isPropertyAccessExpression(target) ? target.name : target.argumentExpression,
      );
    }
  }

  for (const call of mutationCallNodes) {
    const callee = unwrapTransparentExpression(call.expression);
    if (
      !isPropertyAccessExpression(callee) ||
      !isIdentifier(callee.expression) ||
      callee.expression.text !== "Object" ||
      callee.name.text !== "assign" ||
      resolveIdentifier(callee.expression) ||
      call.arguments.length < 2
    ) {
      continue;
    }
    const receiver = call.arguments[0];
    for (const owner of classesForReceiver(receiver)) {
      for (const source of call.arguments.slice(1)) {
        for (const { member, node, write } of objectMutationEntries(
          source,
          call,
          resolveIdentifier,
        )) {
          recordClassAssignment(owner, member, node, call, undefined, write);
        }
      }
    }
  }

  return {
    assignmentsForClass: (node) => classAssignments.get(node) ?? [],
    bindingEntriesForName: (name) =>
      bindNameEntries(name, declarationBindings, declarationBindingsByRange),
    classForThis: enclosingThisClass,
    exportedBindings,
    exportedDefinitions,
    exportedExpressions,
    resolveIdentifier,
  };
}

function isBlockScopedVariableDeclaration(node) {
  return Boolean(node.parent?.flags & NodeFlags.BlockScoped);
}

function nearestVarScope(scope) {
  while (scope.parent && scope.kind !== "function" && scope.kind !== "source") {
    scope = scope.parent;
  }
  return scope;
}

function hasDeclareModifier(node) {
  const declarationModifiers = node.modifiers ?? [];
  const statementModifiers = isVariableStatement(node.parent?.parent)
    ? (node.parent.parent.modifiers ?? [])
    : [];
  return [...declarationModifiers, ...statementModifiers].some(
    (modifier) => modifier.kind === SyntaxKind.DeclareKeyword,
  );
}

function collectThrownExpressions(node) {
  if (!node) return [];
  const expressions = [];
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (isThrowStatement(current)) {
      if (current.expression) expressions.push(current.expression);
      continue;
    }
    if (
      current !== node &&
      (isFunctionNode(current) || isClassDeclaration(current) || isClassExpression(current))
    ) {
      continue;
    }
    current.forEachChild((child) => {
      pending.push(child);
    });
  }
  return expressions;
}
