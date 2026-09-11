import {
  SyntaxKind,
  isArrayBindingPattern,
  isArrayLiteralExpression,
  isBinaryExpression,
  isBindingElement,
  isIdentifier,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
} from "typescript/unstable/ast";

import {
  classMemberName,
  unwrapTransparentExpression,
  staticPropertyName,
} from "../syntax-utils.mjs";

export function assignmentPatternLeaves(name) {
  const leaves = [];
  const pending = [{ name: unwrapTransparentExpression(name), path: [] }];
  while (pending.length > 0) {
    const current = pending.pop();
    const target = unwrapTransparentExpression(current.name);
    if (isIdentifier(target)) {
      leaves.push({ identifier: target, path: current.path });
      continue;
    }
    if (isArrayLiteralExpression(target)) {
      for (let index = target.elements.length - 1; index >= 0; index -= 1) {
        let element = target.elements[index];
        if (!element || element.kind === SyntaxKind.OmittedExpression) continue;
        let defaultNode;
        let rest = false;
        if (isSpreadElement(element)) {
          rest = true;
          element = element.expression;
        }
        element = unwrapTransparentExpression(element);
        if (isBinaryExpression(element) && element.operatorToken.kind === SyntaxKind.EqualsToken) {
          defaultNode = element.right;
          element = element.left;
        }
        pending.push({
          name: element,
          path: [...current.path, { defaultNode, index, kind: "array", rest }],
        });
      }
      continue;
    }
    if (!isObjectLiteralExpression(target)) continue;
    const excludedKeys = target.properties
      .filter((property) => !isSpreadAssignment(property))
      .map((property) => classMemberName(property.name))
      .filter((key) => key !== undefined);
    for (let index = target.properties.length - 1; index >= 0; index -= 1) {
      const property = target.properties[index];
      if (isSpreadAssignment(property)) {
        pending.push({
          name: property.expression,
          path: [
            ...current.path,
            {
              excludedKeys,
              key: undefined,
              kind: "object",
              rest: true,
            },
          ],
        });
        continue;
      }
      if (isShorthandPropertyAssignment(property)) {
        pending.push({
          name: property.name,
          path: [
            ...current.path,
            {
              defaultNode: property.objectAssignmentInitializer,
              excludedKeys,
              key: property.name.text,
              kind: "object",
              rest: false,
            },
          ],
        });
        continue;
      }
      if (!isPropertyAssignment(property)) continue;
      let propertyTarget = unwrapTransparentExpression(property.initializer);
      let defaultNode;
      if (
        isBinaryExpression(propertyTarget) &&
        propertyTarget.operatorToken.kind === SyntaxKind.EqualsToken
      ) {
        defaultNode = propertyTarget.right;
        propertyTarget = propertyTarget.left;
      }
      pending.push({
        name: propertyTarget,
        path: [
          ...current.path,
          {
            defaultNode,
            excludedKeys,
            key: classMemberName(property.name),
            kind: "object",
            rest: false,
          },
        ],
      });
    }
  }
  return leaves;
}

export function bindNameEntries(name, declarationBindings, declarationBindingsByRange) {
  return bindingPatternLeaves(name).flatMap(({ identifier, path }) => {
    const binding =
      declarationBindings.get(identifier) ??
      declarationBindingsByRange.get(`${identifier.kind}:${identifier.pos}:${identifier.end}`);
    return binding ? [{ binding, path }] : [];
  });
}

export function bindingPatternLeaves(name) {
  if (!name) return [];
  const leaves = [];
  const pending = [{ name, path: [] }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current.name) continue;
    if (isIdentifier(current.name)) {
      leaves.push({ identifier: current.name, path: current.path });
      continue;
    }
    if (isArrayBindingPattern(current.name)) {
      for (let index = current.name.elements.length - 1; index >= 0; index -= 1) {
        const element = current.name.elements[index];
        if (!element || !isBindingElement(element) || !element.name) continue;
        pending.push({
          name: element.name,
          path: [
            ...current.path,
            {
              defaultNode: element.initializer,
              index,
              kind: "array",
              rest: Boolean(element.dotDotDotToken),
            },
          ],
        });
      }
      continue;
    }
    if (!isObjectBindingPattern(current.name)) continue;
    const excludedKeys = current.name.elements
      .filter((element) => element && isBindingElement(element) && !element.dotDotDotToken)
      .map((element) => staticPropertyName(element.propertyName ?? element.name))
      .filter((key) => key !== undefined);
    for (let index = current.name.elements.length - 1; index >= 0; index -= 1) {
      const element = current.name.elements[index];
      if (!element || !isBindingElement(element) || !element.name) continue;
      pending.push({
        name: element.name,
        path: [
          ...current.path,
          {
            defaultNode: element.initializer,
            excludedKeys,
            key: element.dotDotDotToken
              ? undefined
              : staticPropertyName(element.propertyName ?? element.name),
            kind: "object",
            rest: Boolean(element.dotDotDotToken),
          },
        ],
      });
    }
  }
  return leaves;
}
