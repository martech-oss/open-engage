import {
  SyntaxKind,
  isArrowFunction,
  isBlock,
  isClassDeclaration,
  isClassExpression,
  isConditionalExpression,
  isConstructorDeclaration,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isPropertyDeclaration,
  isPrivateIdentifier,
  isReturnStatement,
  isSpreadElement,
  isYieldExpression,
} from "typescript/unstable/ast";

import { classMemberName, isFunctionNode, unwrapTransparentExpression } from "../syntax-utils.mjs";
import { createContext, effectiveDefinitions, valueFact, addProvenance } from "./values.mjs";

export function createCallableAnalyzer({
  model,
  bindingProvenance,
  expressionProvenance,
  projectedExpressionFact,
}) {
  function callableDefinitions(node, seenBindings) {
    node = unwrapTransparentExpression(node);
    if (isFunctionNode(node)) return node.body ? [node] : [];
    if (isConditionalExpression(node)) {
      return [
        ...callableDefinitions(node.whenTrue, seenBindings),
        ...callableDefinitions(node.whenFalse, seenBindings),
      ];
    }
    if (!isIdentifier(node)) return [];
    const binding = model.resolveIdentifier(node);
    if (!binding || seenBindings.has(binding)) return [];
    seenBindings.add(binding);
    return effectiveDefinitions(binding, node).flatMap((definition) => {
      if (definition.kind === "function") return definition.node.body ? [definition.node] : [];
      if (definition.kind === "expression") {
        return callableDefinitions(definition.node, seenBindings);
      }
      return [];
    });
  }

  function classDefinitions(node, seenBindings) {
    node = unwrapTransparentExpression(node);
    if (isClassDeclaration(node) || isClassExpression(node)) return [node];
    if (isConditionalExpression(node)) {
      return [
        ...classDefinitions(node.whenTrue, seenBindings),
        ...classDefinitions(node.whenFalse, seenBindings),
      ];
    }
    if (!isIdentifier(node)) return [];
    const binding = model.resolveIdentifier(node);
    if (!binding || seenBindings.has(binding)) return [];
    seenBindings.add(binding);
    return effectiveDefinitions(binding, node).flatMap((definition) => {
      if (definition.kind === "class") return [definition.node];
      if (definition.kind === "expression") return classDefinitions(definition.node, seenBindings);
      return [];
    });
  }

  function callableOutputProvenance(node, parentContext, argumentsList = []) {
    if (parentContext.activeCallables.has(node)) return new Set();
    parentContext.activeCallables.add(node);
    const context = createCallableContext(node, parentContext, argumentsList);
    try {
      if (isArrowFunction(node) && node.body && !isBlock(node.body)) {
        return expressionProvenance(node.body, context);
      }
      const provenance = new Set();
      if (node.body) collectCallableOutputs(node.body, context, provenance);
      return provenance;
    } finally {
      parentContext.activeCallables.delete(node);
    }
  }

  function createCallableContext(node, parentContext, argumentsList = []) {
    const context = createContext(parentContext);
    for (const [index, parameter] of (node.parameters ?? []).entries()) {
      const argument = parameter.dotDotDotToken
        ? undefined
        : argumentsList[index]
          ? isSpreadElement(argumentsList[index])
            ? argumentsList[index].expression
            : argumentsList[index]
          : parameter.initializer;
      for (const { binding, path } of model.bindingEntriesForName(parameter.name)) {
        const parameterFact = parameter.dotDotDotToken
          ? valueFact(
              provenanceForExpressions(argumentsList.slice(index), parentContext),
              "nonundefined",
            )
          : projectedExpressionFact(argument, path, context);
        context.overrides.set(binding, parameterFact);
        if (path.length === 0 && argument) {
          context.sourceOverrides.set(binding, {
            context: argument === parameter.initializer ? context : parentContext,
            expressions: [argument],
          });
        }
      }
    }
    return context;
  }

  function provenanceForExpressions(expressions, context) {
    const provenance = new Set();
    for (const expression of expressions) {
      addProvenance(
        provenance,
        expressionProvenance(
          isSpreadElement(expression) ? expression.expression : expression,
          context,
        ),
      );
    }
    return provenance;
  }

  function collectCallableOutputs(node, context, provenance) {
    const pending = [node];
    while (pending.length > 0) {
      const current = pending.pop();
      if (isReturnStatement(current) || isYieldExpression(current)) {
        if (current.expression) {
          addProvenance(provenance, expressionProvenance(current.expression, context));
        }
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
  }

  function effectiveClassAssignments(node, memberName) {
    const groups = new Map();
    for (const assignment of model.assignmentsForClass(node)) {
      if (memberName !== undefined && assignment.member !== memberName) continue;
      let callableGroups = groups.get(assignment.member);
      if (!callableGroups) {
        callableGroups = new Map();
        groups.set(assignment.member, callableGroups);
      }
      const key = assignment.ownerCallable ?? node;
      const records = callableGroups.get(key) ?? [];
      records.push(assignment);
      callableGroups.set(key, records);
    }
    const effective = [];
    for (const callableGroups of groups.values()) {
      for (const records of callableGroups.values()) {
        let values = [];
        for (const assignment of records.sort((left, right) => left.position - right.position)) {
          if (assignment.write === "replace") values = [assignment];
          else values.push(assignment);
        }
        effective.push(...values);
      }
    }
    return effective;
  }

  function classOutputProvenance(node, context, argumentsList = []) {
    if (context.activeClasses.has(node)) return new Set();
    context.activeClasses.add(node);
    const provenance = new Set();
    const hadInstanceContext = context.classInstanceContexts.has(node);
    const previousInstanceContext = context.classInstanceContexts.get(node);
    try {
      const constructor = node.members.find((member) => isConstructorDeclaration(member));
      const constructorContext = constructor
        ? createCallableContext(constructor, context, argumentsList)
        : context;
      context.classInstanceContexts.set(node, constructorContext);
      if (constructor) {
        for (const parameter of constructor.parameters ?? []) {
          if (!isPublicParameterProperty(parameter)) continue;
          for (const { binding } of model.bindingEntriesForName(parameter.name)) {
            addProvenance(provenance, bindingProvenance(binding, constructorContext));
          }
        }
      }
      for (const member of node.members) {
        if (isPrivateClassMember(member)) continue;
        if (isPropertyDeclaration(member) && member.initializer) {
          addProvenance(provenance, expressionProvenance(member.initializer, context));
        } else if (isGetAccessorDeclaration(member) || isMethodDeclaration(member)) {
          addProvenance(provenance, callableOutputProvenance(member, context));
        }
      }
      for (const assignment of effectiveClassAssignments(node)) {
        if (assignment.private || classMemberIsPrivate(node, assignment.member)) continue;
        const assignmentContext = assignment.ownerCallable
          ? assignment.ownerCallable === constructor
            ? constructorContext
            : createCallableContext(assignment.ownerCallable, context)
          : context;
        addProvenance(provenance, expressionProvenance(assignment.node, assignmentContext));
      }
      return provenance;
    } finally {
      if (hadInstanceContext) context.classInstanceContexts.set(node, previousInstanceContext);
      else context.classInstanceContexts.delete(node);
      context.activeClasses.delete(node);
    }
  }

  function classMemberValueProvenance(node, memberName, context) {
    let activeMembers = context.activeMemberClasses.get(node);
    if (!activeMembers) {
      activeMembers = new Set();
      context.activeMemberClasses.set(node, activeMembers);
    }
    if (activeMembers.has(memberName)) return new Set();
    activeMembers.add(memberName);
    const provenance = new Set();
    try {
      for (const member of node.members) {
        if (isConstructorDeclaration(member)) {
          const instanceContext = context.classInstanceContexts.get(node) ?? context;
          for (const parameter of member.parameters ?? []) {
            if (classMemberName(parameter.name) !== memberName) continue;
            for (const { binding } of model.bindingEntriesForName(parameter.name)) {
              addProvenance(provenance, bindingProvenance(binding, instanceContext));
            }
          }
          continue;
        }
        if (classMemberName(member.name) !== memberName) continue;
        if (isPropertyDeclaration(member) && member.initializer) {
          addProvenance(provenance, expressionProvenance(member.initializer, context));
        }
      }
      for (const assignment of effectiveClassAssignments(node, memberName)) {
        addProvenance(provenance, expressionProvenance(assignment.node, context));
      }
      return provenance;
    } finally {
      activeMembers.delete(memberName);
    }
  }

  return {
    callableDefinitions,
    classDefinitions,
    callableOutputProvenance,
    classOutputProvenance,
    classMemberValueProvenance,
  };
}
function isPrivateClassMember(member) {
  return (
    (member.name && isPrivateIdentifier(member.name)) ||
    (member.modifiers?.some((modifier) => modifier.kind === SyntaxKind.PrivateKeyword) ?? false)
  );
}

function classMemberIsPrivate(node, memberName) {
  return node.members.some(
    (member) => classMemberName(member.name) === memberName && isPrivateClassMember(member),
  );
}

function isPublicParameterProperty(parameter) {
  const modifiers = new Set(parameter.modifiers?.map((modifier) => modifier.kind) ?? []);
  const isParameterProperty = [
    SyntaxKind.PublicKeyword,
    SyntaxKind.PrivateKeyword,
    SyntaxKind.ProtectedKeyword,
    SyntaxKind.ReadonlyKeyword,
  ].some((kind) => modifiers.has(kind));
  return (
    isParameterProperty &&
    !modifiers.has(SyntaxKind.PrivateKeyword) &&
    !modifiers.has(SyntaxKind.ProtectedKeyword)
  );
}
