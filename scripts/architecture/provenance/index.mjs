import {
  SyntaxKind,
  isArrayLiteralExpression,
  isAwaitExpression,
  isBinaryExpression,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isConditionalExpression,
  isElementAccessExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isYieldExpression,
} from "typescript/unstable/ast";

import {
  classMemberName,
  isFunctionNode,
  staticString,
  unwrapTransparentExpression,
} from "../syntax-utils.mjs";
import { createCallableAnalyzer } from "./callables.mjs";
import { createProjectionAnalyzer } from "./projections.mjs";
import {
  createContext,
  referencePosition,
  effectiveDefinitions,
  valueFact,
  joinDefinedness,
  enqueueExpressions,
  isKnownPrimitiveSanitizer,
  isTransparentValueCall,
  binaryOperatorCanReturnOperand,
  addProvenance,
} from "./values.mjs";

// Each analyzer owns a fresh evaluation context. Explicit callbacks connect the
// recursive value, destructuring, and callable-output analyses without shared state.
export function createProvenanceAnalyzer(model) {
  const {
    callableDefinitions,
    classDefinitions,
    callableOutputProvenance,
    classOutputProvenance,
    classMemberValueProvenance,
  } = createCallableAnalyzer({
    model,
    bindingProvenance,
    expressionProvenance,
    projectedExpressionFact: (...args) => projectedExpressionFact(...args),
  });
  const { projectedExpressionFact, projectedExpressionProvenance } = createProjectionAnalyzer({
    model,
    definitionProvenance,
    definitionDefinedness,
    expressionFact,
    expressionDefinedness,
    expressionProvenance,
    callableOutputProvenance,
  });
  function bindingProvenance(binding, context, reference) {
    if (context.overrides.has(binding)) return context.overrides.get(binding).provenance;
    const position = referencePosition(reference);
    let bindingCache = context.cache.get(binding);
    if (!bindingCache) {
      bindingCache = new Map();
      context.cache.set(binding, bindingCache);
    }
    if (bindingCache.has(position)) return bindingCache.get(position);
    const resolvingPositions = context.resolving.get(binding) ?? new Set();
    if (resolvingPositions.has(position)) return new Set();

    resolvingPositions.add(position);
    context.resolving.set(binding, resolvingPositions);
    const provenance = new Set(binding.importSpecifiers);
    for (const definition of effectiveDefinitions(binding, reference)) {
      addProvenance(provenance, definitionProvenance(definition, context));
    }
    resolvingPositions.delete(position);
    if (resolvingPositions.size === 0) context.resolving.delete(binding);
    bindingCache.set(position, provenance);
    return provenance;
  }

  function bindingDefinedness(binding, context, reference) {
    if (context.overrides.has(binding)) return context.overrides.get(binding).definedness;
    const position = referencePosition(reference);
    const resolvingPositions = context.resolvingDefinedness.get(binding) ?? new Set();
    if (resolvingPositions.has(position)) return "unknown";
    resolvingPositions.add(position);
    context.resolvingDefinedness.set(binding, resolvingPositions);
    try {
      const definitions = effectiveDefinitions(binding, reference);
      if (definitions.length === 0) return "unknown";
      return joinDefinedness(
        definitions.map((definition) => definitionDefinedness(definition, context)),
      );
    } finally {
      resolvingPositions.delete(position);
      if (resolvingPositions.size === 0) context.resolvingDefinedness.delete(binding);
    }
  }

  function definitionProvenance(definition, context) {
    if (definition.kind === "expression") return expressionProvenance(definition.node, context);
    if (definition.kind === "expressions") {
      const provenance = new Set();
      for (const node of definition.nodes) {
        addProvenance(provenance, expressionProvenance(node, context));
      }
      return provenance;
    }
    if (definition.kind === "projection") {
      return projectedExpressionProvenance(definition.node, definition.path, context);
    }
    if (definition.kind === "projection-list") {
      const provenance = new Set();
      for (const node of definition.nodes) {
        addProvenance(provenance, projectedExpressionProvenance(node, definition.path, context));
      }
      return provenance;
    }
    if (definition.kind === "function") return callableOutputProvenance(definition.node, context);
    if (definition.kind === "class") return classOutputProvenance(definition.node, context);
    return new Set();
  }

  function definitionDefinedness(definition, context) {
    if (definition.kind === "undefined") return "undefined";
    if (definition.kind === "unknown" || definition.kind === "parameter") return "unknown";
    if (definition.kind === "expression") return expressionDefinedness(definition.node, context);
    if (definition.kind === "expressions") {
      return joinDefinedness(definition.nodes.map((node) => expressionDefinedness(node, context)));
    }
    if (definition.kind === "projection") {
      return projectedExpressionFact(definition.node, definition.path, context).definedness;
    }
    if (definition.kind === "projection-list") {
      return joinDefinedness(
        definition.nodes.map(
          (node) => projectedExpressionFact(node, definition.path, context).definedness,
        ),
      );
    }
    if (definition.kind === "function" || definition.kind === "class") return "nonundefined";
    return "unknown";
  }

  function expressionFact(expression, context) {
    if (!expression) return valueFact(new Set(), "undefined");
    return valueFact(
      expressionProvenance(expression, context),
      expressionDefinedness(expression, context),
    );
  }

  function expressionDefinedness(expression, context) {
    if (!expression) return "undefined";
    const node = unwrapTransparentExpression(expression);
    if (isIdentifier(node)) {
      if (node.text === "undefined" && !model.resolveIdentifier(node)) return "undefined";
      const binding = model.resolveIdentifier(node);
      return binding ? bindingDefinedness(binding, context, node) : "unknown";
    }
    if (
      isObjectLiteralExpression(node) ||
      isArrayLiteralExpression(node) ||
      isFunctionNode(node) ||
      isClassDeclaration(node) ||
      isClassExpression(node) ||
      isNewExpression(node)
    ) {
      return "nonundefined";
    }
    if (
      [
        SyntaxKind.StringLiteral,
        SyntaxKind.NoSubstitutionTemplateLiteral,
        SyntaxKind.NumericLiteral,
        SyntaxKind.BigIntLiteral,
        SyntaxKind.RegularExpressionLiteral,
        SyntaxKind.TrueKeyword,
        SyntaxKind.FalseKeyword,
        SyntaxKind.NullKeyword,
      ].includes(node.kind)
    ) {
      return "nonundefined";
    }
    if (node.kind === SyntaxKind.VoidExpression) return "undefined";
    if (isConditionalExpression(node)) {
      return joinDefinedness([
        expressionDefinedness(node.whenTrue, context),
        expressionDefinedness(node.whenFalse, context),
      ]);
    }
    if (isAwaitExpression(node)) return expressionDefinedness(node.expression, context);
    if (isBinaryExpression(node)) {
      if (
        node.operatorToken.kind === SyntaxKind.EqualsToken ||
        node.operatorToken.kind === SyntaxKind.CommaToken
      ) {
        return expressionDefinedness(node.right, context);
      }
      if (
        node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === SyntaxKind.BarBarToken ||
        node.operatorToken.kind === SyntaxKind.QuestionQuestionToken
      ) {
        return joinDefinedness([
          expressionDefinedness(node.left, context),
          expressionDefinedness(node.right, context),
        ]);
      }
    }
    if (
      isCallExpression(node) &&
      isKnownPrimitiveSanitizer(node.expression) &&
      !model.resolveIdentifier(unwrapTransparentExpression(node.expression))
    ) {
      return "nonundefined";
    }
    return "unknown";
  }

  function expressionProvenance(expression, context) {
    const provenance = new Set();
    const pending = [expression];
    while (pending.length > 0) {
      const node = unwrapTransparentExpression(pending.pop());
      if (isIdentifier(node)) {
        const binding = model.resolveIdentifier(node);
        if (binding) addProvenance(provenance, bindingProvenance(binding, context, node));
      } else if (isFunctionNode(node)) {
        addProvenance(provenance, callableOutputProvenance(node, context));
      } else if (isClassDeclaration(node) || isClassExpression(node)) {
        addProvenance(provenance, classOutputProvenance(node, context));
      } else if (isPropertyAccessExpression(node)) {
        const owner =
          unwrapTransparentExpression(node.expression).kind === SyntaxKind.ThisKeyword
            ? model.classForThis(node)
            : undefined;
        const member = classMemberName(node.name);
        if (owner && member !== undefined) {
          addProvenance(provenance, classMemberValueProvenance(owner, member, context));
        } else {
          pending.push(node.expression);
        }
      } else if (isElementAccessExpression(node)) {
        const owner =
          unwrapTransparentExpression(node.expression).kind === SyntaxKind.ThisKeyword
            ? model.classForThis(node)
            : undefined;
        const member = staticString(node.argumentExpression);
        if (owner && member !== undefined) {
          addProvenance(provenance, classMemberValueProvenance(owner, member, context));
        } else {
          enqueueExpressions(pending, [node.expression, node.argumentExpression]);
        }
      } else if (isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
          if (isPropertyAssignment(property)) {
            pending.push(property.initializer);
          } else if (isShorthandPropertyAssignment(property)) {
            const binding = model.resolveIdentifier(property.name);
            if (binding) {
              addProvenance(provenance, bindingProvenance(binding, context, property.name));
            }
          } else if (isSpreadAssignment(property)) {
            pending.push(property.expression);
          } else if (isMethodDeclaration(property) || isGetAccessorDeclaration(property)) {
            addProvenance(provenance, callableOutputProvenance(property, context));
          }
        }
      } else if (isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
          pending.push(isSpreadElement(element) ? element.expression : element);
        }
      } else if (isConditionalExpression(node)) {
        enqueueExpressions(pending, [node.whenTrue, node.whenFalse]);
      } else if (isCallExpression(node)) {
        const callables = callableDefinitions(node.expression, new Set());
        if (callables.length > 0) {
          for (const callable of callables) {
            addProvenance(provenance, callableOutputProvenance(callable, context, node.arguments));
          }
        } else if (
          !knownCallResultCannotContainArgument(node.expression) &&
          (isTransparentValueCall(node.expression) || unknownCallCanReturnArgument(node.expression))
        ) {
          enqueueExpressions(pending, node.arguments ?? []);
        }
      } else if (isNewExpression(node)) {
        const classes = classDefinitions(node.expression, new Set());
        if (classes.length > 0) {
          for (const classNode of classes) {
            addProvenance(
              provenance,
              classOutputProvenance(classNode, context, node.arguments ?? []),
            );
          }
        } else if (unknownCallCanReturnArgument(node.expression)) {
          enqueueExpressions(pending, node.arguments ?? []);
        }
      } else if (
        isBinaryExpression(node) &&
        binaryOperatorCanReturnOperand(node.operatorToken.kind)
      ) {
        enqueueExpressions(pending, [node.left, node.right]);
      } else if (isAwaitExpression(node) || isYieldExpression(node)) {
        if (node.expression) pending.push(node.expression);
      }
    }
    return provenance;
  }

  function unknownCallCanReturnArgument(node) {
    node = unwrapTransparentExpression(node);
    if (isIdentifier(node)) return true;
    if (!isPropertyAccessExpression(node) && !isElementAccessExpression(node)) return false;
    const receiver = unwrapTransparentExpression(node.expression);
    if (!isIdentifier(receiver)) return false;
    const binding = model.resolveIdentifier(receiver);
    return Boolean(binding?.importSpecifiers.size);
  }

  function knownCallResultCannotContainArgument(node) {
    node = unwrapTransparentExpression(node);
    if (isKnownPrimitiveSanitizer(node) && !model.resolveIdentifier(node)) return true;
    if (!isIdentifier(node)) return false;
    const binding = model.resolveIdentifier(node);
    return [...(binding?.importSpecifiers ?? [])].some(
      (specifier) =>
        specifier === "drizzle-orm" ||
        specifier.startsWith("drizzle-orm/") ||
        (node.text === "decodeJson" && /(?:^|\/)shared\/json-codec$/.test(specifier)),
    );
  }

  const rootContext = createContext();
  return {
    forBinding: (binding) => bindingProvenance(binding, rootContext),
    forDefinition: (definition) => definitionProvenance(definition, rootContext),
    forExpression: (expression) => expressionProvenance(expression, rootContext),
  };
}
