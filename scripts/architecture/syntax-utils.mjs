import {
  isAsExpression,
  isArrowFunction,
  isClassDeclaration,
  isClassExpression,
  isComputedPropertyName,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isNonNullExpression,
  isNoSubstitutionTemplateLiteral,
  isParenthesizedExpression,
  isPrivateIdentifier,
  isSatisfiesExpression,
  isSetAccessorDeclaration,
  isStringLiteral,
  isTypeAssertion,
} from "typescript/unstable/ast";

export function classMemberName(name) {
  if (!name) return undefined;
  if (isPrivateIdentifier(name)) return name.text;
  return staticPropertyName(name);
}

export function enclosingThisClass(node) {
  let current = node.parent;
  while (current) {
    if (isClassDeclaration(current) || isClassExpression(current)) return current;
    if (isFunctionDeclaration(current) || isFunctionExpression(current)) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

export function enclosingCallable(node, boundary) {
  let current = node.parent;
  while (current && current !== boundary) {
    if (isFunctionNode(current)) return current;
    current = current.parent;
  }
  return undefined;
}

export function isFunctionNode(node) {
  return (
    isFunctionDeclaration(node) ||
    isFunctionExpression(node) ||
    isArrowFunction(node) ||
    isMethodDeclaration(node) ||
    isGetAccessorDeclaration(node) ||
    isSetAccessorDeclaration(node) ||
    isConstructorDeclaration(node)
  );
}

export function bindingIsCallableSurface(binding) {
  return binding.definitions.some(definitionIsCallableSurface);
}

export function definitionIsCallableSurface(definition) {
  if (definition.kind === "function" || definition.kind === "class") return true;
  return definition.kind === "expression" && expressionIsCallableSurface(definition.node);
}

export function expressionIsCallableSurface(expression) {
  const node = unwrapTransparentExpression(expression);
  return isFunctionNode(node) || isClassDeclaration(node) || isClassExpression(node);
}

export function staticString(node) {
  if (!node) return undefined;
  node = unwrapTransparentExpression(node);
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

export function unwrapTransparentExpression(node) {
  while (
    isParenthesizedExpression(node) ||
    isAsExpression(node) ||
    isTypeAssertion(node) ||
    isSatisfiesExpression(node) ||
    isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

export function staticPropertyName(node) {
  if (!node) return undefined;
  if (isIdentifier(node)) return node.text;
  if (isComputedPropertyName(node)) return staticString(node.expression);
  return staticString(node);
}
