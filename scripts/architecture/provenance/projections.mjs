import {
  SyntaxKind,
  isArrayLiteralExpression,
  isConditionalExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
} from "typescript/unstable/ast";

import { classMemberName, unwrapTransparentExpression } from "../syntax-utils.mjs";
import {
  effectiveDefinitions,
  valueFact,
  joinDefinedness,
  mergeFacts,
  addProvenance,
} from "./values.mjs";

export function createProjectionAnalyzer({
  model,
  definitionProvenance,
  definitionDefinedness,
  expressionFact,
  expressionDefinedness,
  expressionProvenance,
  callableOutputProvenance,
}) {
  function projectedExpressionProvenance(expression, path, context, pathIndex = 0) {
    return projectedExpressionFact(expression, path, context, pathIndex).provenance;
  }

  function projectedExpressionFact(
    expression,
    path,
    context,
    pathIndex = 0,
    seenBindings = new Set(),
  ) {
    if (pathIndex >= path.length) return expressionFact(expression, context);
    const step = path[pathIndex];
    if (!expression) {
      return applyProjectionDefault(
        valueFact(new Set(), "undefined"),
        step.defaultNode,
        path,
        context,
        pathIndex + 1,
      );
    }

    const node = unwrapTransparentExpression(expression);
    if (isIdentifier(node)) {
      const binding = model.resolveIdentifier(node);
      if (binding && !seenBindings.has(binding)) {
        const nestedSeen = new Set(seenBindings);
        nestedSeen.add(binding);
        const sourceOverride = context.sourceOverrides.get(binding);
        if (sourceOverride) {
          return mergeFacts(
            sourceOverride.expressions.map((source) =>
              projectedExpressionFact(source, path, sourceOverride.context, pathIndex, nestedSeen),
            ),
          );
        }
        const facts = effectiveDefinitions(binding, node).map((definition) => {
          if (definition.kind === "expression") {
            return projectedExpressionFact(definition.node, path, context, pathIndex, nestedSeen);
          }
          if (definition.kind === "expressions") {
            return mergeFacts(
              definition.nodes.map((source) =>
                projectedExpressionFact(source, path, context, pathIndex, nestedSeen),
              ),
            );
          }
          const fact = valueFact(
            definitionProvenance(definition, context),
            definitionDefinedness(definition, context),
          );
          return applyProjectionDefault(fact, step.defaultNode, path, context, pathIndex + 1);
        });
        if (facts.length > 0) return mergeFacts(facts);
      }
    }

    if (step.kind === "array" && isArrayLiteralExpression(node)) {
      if (step.rest) {
        const facts = [];
        for (const element of node.elements.slice(step.index)) {
          if (!element || element.kind === SyntaxKind.OmittedExpression) continue;
          facts.push(
            projectedExpressionFact(
              isSpreadElement(element) ? element.expression : element,
              path,
              context,
              pathIndex + 1,
              seenBindings,
            ),
          );
        }
        return mergeFacts(facts, "nonundefined");
      }
      const element = node.elements[step.index];
      if (!element || element.kind === SyntaxKind.OmittedExpression) {
        return applyProjectionDefault(
          valueFact(new Set(), "undefined"),
          step.defaultNode,
          path,
          context,
          pathIndex + 1,
        );
      }
      if (isSpreadElement(element)) {
        return applyProjectionDefault(
          valueFact(expressionProvenance(element.expression, context), "unknown"),
          step.defaultNode,
          path,
          context,
          pathIndex + 1,
        );
      }
      return applyProjectionDefault(
        projectedExpressionFact(element, path, context, pathIndex + 1, seenBindings),
        step.defaultNode,
        path,
        context,
        pathIndex + 1,
        expressionDefinedness(element, context),
      );
    }

    if (step.kind === "object") {
      if (step.rest) {
        return objectRestFact(node, step.excludedKeys, context, seenBindings);
      }
      if (step.key !== undefined) {
        const selection = objectPropertySelection(
          node,
          step.key,
          path,
          context,
          pathIndex + 1,
          seenBindings,
        );
        const selected =
          selection.presence === "absent"
            ? valueFact(new Set(), "undefined")
            : valueFact(selection.provenance, selection.definedness);
        return applyProjectionDefault(selected, step.defaultNode, path, context, pathIndex + 1);
      }
    }

    return applyProjectionDefault(
      expressionFact(node, context),
      step.defaultNode,
      path,
      context,
      pathIndex + 1,
    );
  }

  function applyProjectionDefault(
    selected,
    defaultNode,
    path,
    context,
    nextPathIndex,
    selectedDefinedness = selected.definedness,
  ) {
    if (!defaultNode || selectedDefinedness === "nonundefined") return selected;
    const fallback = projectedExpressionFact(defaultNode, path, context, nextPathIndex);
    if (selectedDefinedness === "undefined") return fallback;
    const definedness = fallback.definedness === "nonundefined" ? "nonundefined" : "unknown";
    return mergeFacts([selected, fallback], definedness);
  }

  function emptyObjectSelection() {
    return { definedness: "undefined", presence: "absent", provenance: new Set() };
  }

  function selectionForProperty(property, path, context, nextPathIndex, seenBindings) {
    let expression;
    if (isPropertyAssignment(property)) expression = property.initializer;
    else if (isShorthandPropertyAssignment(property)) expression = property.name;
    else if (isMethodDeclaration(property) || isGetAccessorDeclaration(property)) {
      return {
        definedness: "nonundefined",
        presence: "present",
        provenance: callableOutputProvenance(property, context),
      };
    } else {
      return { definedness: "unknown", presence: "unknown", provenance: new Set() };
    }
    const fact = projectedExpressionFact(expression, path, context, nextPathIndex, seenBindings);
    return {
      definedness: expressionDefinedness(expression, context),
      presence: "present",
      provenance: fact.provenance,
    };
  }

  function mergeAlternativeSelections(selections) {
    if (selections.length === 0) return emptyObjectSelection();
    const provenance = new Set();
    for (const selection of selections) addProvenance(provenance, selection.provenance);
    const presences = new Set(selections.map((selection) => selection.presence));
    return {
      definedness: joinDefinedness(selections.map((selection) => selection.definedness)),
      presence: presences.size === 1 ? selections[0].presence : "unknown",
      provenance,
    };
  }

  function overlayObjectSelection(previous, incoming) {
    if (incoming.presence === "absent") return previous;
    if (incoming.presence === "present") return incoming;
    const provenance = new Set(previous.provenance);
    addProvenance(provenance, incoming.provenance);
    return {
      definedness: joinDefinedness([previous.definedness, incoming.definedness]),
      presence: previous.presence === "present" ? "present" : "unknown",
      provenance,
    };
  }

  function objectPropertySelection(expression, key, path, context, nextPathIndex, seenBindings) {
    const node = unwrapTransparentExpression(expression);
    if (isObjectLiteralExpression(node)) {
      let selection = emptyObjectSelection();
      for (const property of node.properties) {
        if (isSpreadAssignment(property)) {
          selection = overlayObjectSelection(
            selection,
            objectPropertySelection(
              property.expression,
              key,
              path,
              context,
              nextPathIndex,
              seenBindings,
            ),
          );
          continue;
        }
        const propertyKey = classMemberName(property.name);
        if (propertyKey === key) {
          selection = selectionForProperty(property, path, context, nextPathIndex, seenBindings);
        } else if (propertyKey === undefined) {
          selection = overlayObjectSelection(selection, {
            definedness: "unknown",
            presence: "unknown",
            provenance: objectPropertyValueProvenance(property, context),
          });
        }
      }
      return selection;
    }
    if (isConditionalExpression(node)) {
      return mergeAlternativeSelections([
        objectPropertySelection(node.whenTrue, key, path, context, nextPathIndex, seenBindings),
        objectPropertySelection(node.whenFalse, key, path, context, nextPathIndex, seenBindings),
      ]);
    }
    if (isIdentifier(node)) {
      const binding = model.resolveIdentifier(node);
      if (binding && !seenBindings.has(binding)) {
        const nestedSeen = new Set(seenBindings);
        nestedSeen.add(binding);
        const sourceOverride = context.sourceOverrides.get(binding);
        if (sourceOverride) {
          return mergeAlternativeSelections(
            sourceOverride.expressions.map((source) =>
              objectPropertySelection(
                source,
                key,
                path,
                sourceOverride.context,
                nextPathIndex,
                nestedSeen,
              ),
            ),
          );
        }
        const selections = effectiveDefinitions(binding, node).flatMap((definition) => {
          if (definition.kind === "expression") {
            return [
              objectPropertySelection(
                definition.node,
                key,
                path,
                context,
                nextPathIndex,
                nestedSeen,
              ),
            ];
          }
          if (definition.kind === "expressions") {
            return definition.nodes.map((source) =>
              objectPropertySelection(source, key, path, context, nextPathIndex, nestedSeen),
            );
          }
          return [];
        });
        if (selections.length > 0) return mergeAlternativeSelections(selections);
      }
    }
    return {
      definedness: "unknown",
      presence: "unknown",
      provenance: expressionProvenance(node, context),
    };
  }

  function objectPropertyValueProvenance(property, context) {
    if (isPropertyAssignment(property)) return expressionProvenance(property.initializer, context);
    if (isShorthandPropertyAssignment(property)) {
      return expressionProvenance(property.name, context);
    }
    if (isMethodDeclaration(property) || isGetAccessorDeclaration(property)) {
      return callableOutputProvenance(property, context);
    }
    return new Set();
  }

  function objectRestFact(expression, excludedKeys, context, seenBindings) {
    const shape = objectShape(expression, context, seenBindings);
    const provenance = new Set(shape.unknownProvenance);
    for (const [key, fact] of shape.properties) {
      if (!excludedKeys.includes(key)) addProvenance(provenance, fact.provenance);
    }
    return valueFact(provenance, "nonundefined");
  }

  function objectShape(expression, context, seenBindings = new Set()) {
    const node = unwrapTransparentExpression(expression);
    if (isObjectLiteralExpression(node)) {
      const shape = { properties: new Map(), unknownProvenance: new Set() };
      for (const property of node.properties) {
        if (isSpreadAssignment(property)) {
          const spreadShape = objectShape(property.expression, context, seenBindings);
          for (const [key, fact] of spreadShape.properties) shape.properties.set(key, fact);
          addProvenance(shape.unknownProvenance, spreadShape.unknownProvenance);
          continue;
        }
        const key = classMemberName(property.name);
        if (key === undefined) {
          addProvenance(shape.unknownProvenance, objectPropertyValueProvenance(property, context));
          continue;
        }
        shape.properties.set(
          key,
          valueFact(objectPropertyValueProvenance(property, context), "unknown"),
        );
      }
      return shape;
    }
    if (isIdentifier(node)) {
      const binding = model.resolveIdentifier(node);
      if (binding && !seenBindings.has(binding)) {
        const nestedSeen = new Set(seenBindings);
        nestedSeen.add(binding);
        const sourceOverride = context.sourceOverrides.get(binding);
        if (sourceOverride) {
          return mergeObjectShapes(
            sourceOverride.expressions.map((source) =>
              objectShape(source, sourceOverride.context, nestedSeen),
            ),
          );
        }
        const shapes = effectiveDefinitions(binding, node).flatMap((definition) => {
          if (definition.kind === "expression") {
            return [objectShape(definition.node, context, nestedSeen)];
          }
          if (definition.kind === "expressions") {
            return definition.nodes.map((source) => objectShape(source, context, nestedSeen));
          }
          return [];
        });
        if (shapes.length > 0) return mergeObjectShapes(shapes);
      }
    }
    return { properties: new Map(), unknownProvenance: expressionProvenance(node, context) };
  }

  function mergeObjectShapes(shapes) {
    const merged = { properties: new Map(), unknownProvenance: new Set() };
    for (const shape of shapes) {
      addProvenance(merged.unknownProvenance, shape.unknownProvenance);
      for (const [key, fact] of shape.properties) {
        const previous = merged.properties.get(key);
        merged.properties.set(key, previous ? mergeFacts([previous, fact]) : fact);
      }
    }
    return merged;
  }

  return { projectedExpressionFact, projectedExpressionProvenance };
}
