import { relative } from "node:path";

import {
  SyntaxKind,
  isArrowFunction,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isClassStaticBlockDeclaration,
  isConstructorDeclaration,
  isElementAccessExpression,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isMethodDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isNewExpression,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  isSetAccessorDeclaration,
} from "typescript/unstable/ast";
import { API as TypeScriptApi } from "typescript/unstable/sync";

import {
  collectRuntimeImportBindings,
  isRpcTransportSetup,
  objectContainsDisabledSsr,
  isDirectRolePermissionExpression,
} from "./client-facts.mjs";
import { createProvenanceAnalyzer } from "./provenance/index.mjs";
import { createLexicalModel } from "./scope/model.mjs";
import {
  bindingIsCallableSurface,
  definitionIsCallableSurface,
  expressionIsCallableSurface,
  staticString,
  unwrapTransparentExpression,
  staticPropertyName,
} from "./syntax-utils.mjs";

export function extractSourceFacts(root, sourceFiles) {
  if (sourceFiles.length === 0) return new Map();

  const api = new TypeScriptApi({ cwd: root });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openFiles: sourceFiles });
    return new Map(
      sourceFiles.map((file) => {
        const project = snapshot.getDefaultProjectForFile(file);
        const sourceFile = project?.program.getSourceFile(file);
        if (!sourceFile) throw new Error(`TypeScript could not parse ${relative(root, file)}`);
        if (project.program.getSyntacticDiagnostics(file).length > 0) {
          throw new Error(`TypeScript could not parse ${relative(root, file)}`);
        }
        return [file, extractAstFacts(sourceFile)];
      }),
    );
  } finally {
    snapshot?.dispose();
    api.close();
  }
}

function extractAstFacts(sourceFile) {
  const edges = [];
  const lexicalModel = createLexicalModel(sourceFile);
  const runtimeImports = collectRuntimeImportBindings(sourceFile, lexicalModel);
  const functionLikeSpans = [];
  let hasClientRolePermissionLogic = false;
  let hasRpcTransportSetup = false;
  let hasRouteSsrDisabled = false;
  let hasStaticOrmAccess = false;

  function addEdge(kind, node, metadata = {}) {
    const specifier = staticString(node);
    if (specifier !== undefined) edges.push({ kind, specifier, ...metadata });
  }

  function visit(node) {
    if (
      isFunctionDeclaration(node) ||
      isArrowFunction(node) ||
      isFunctionExpression(node) ||
      isMethodDeclaration(node) ||
      isConstructorDeclaration(node) ||
      isGetAccessorDeclaration(node) ||
      isSetAccessorDeclaration(node) ||
      isClassStaticBlockDeclaration(node)
    ) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const end = sourceFile.getLineAndCharacterOfPosition(
        Math.max(node.getStart(sourceFile), node.end - 1),
      ).line;
      functionLikeSpans.push({ lineCount: end - start + 1, startLine: start + 1 });
    }
    if (isImportDeclaration(node)) {
      addEdge("import", node.moduleSpecifier, { runtime: importDeclarationIsRuntime(node) });
    } else if (isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        addEdge("export", node.moduleSpecifier, {
          exportsAll: !node.exportClause,
          runtime: exportDeclarationIsRuntime(node),
        });
      }
    } else if (isImportTypeNode(node)) {
      addEdge(
        "import-type",
        isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument,
      );
    } else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
      // Computed dynamic imports cannot form a canonical static dependency edge and are
      // intentionally ignored. String literals and no-substitution templates are retained.
      addEdge("dynamic-import", node.arguments[0], { runtime: true });
    }

    if (
      (isPropertyAccessExpression(node) && isIdentifier(node.name) && node.name.text === "orm") ||
      (isElementAccessExpression(node) && staticString(node.argumentExpression) === "orm") ||
      (isBindingElement(node) &&
        isObjectBindingPattern(node.parent) &&
        staticPropertyName(node.propertyName ?? node.name) === "orm") ||
      (isBinaryExpression(node) &&
        node.operatorToken.kind === SyntaxKind.EqualsToken &&
        hasOrmAssignmentTarget(node.left))
    ) {
      hasStaticOrmAccess = true;
    }
    if (isObjectLiteralExpression(node) && objectContainsDisabledSsr(node, lexicalModel)) {
      hasRouteSsrDisabled = true;
    }
    if (isDirectRolePermissionExpression(node, lexicalModel)) {
      hasClientRolePermissionLogic = true;
    }
    if (
      (isCallExpression(node) || isNewExpression(node)) &&
      isRpcTransportSetup(node, lexicalModel, runtimeImports)
    ) {
      hasRpcTransportSetup = true;
    }

    node.forEachChild(visit);
  }

  sourceFile.forEachChild(visit);
  const provenance = createProvenanceAnalyzer(lexicalModel);
  const exportedProvenanceEdges = [];
  function addExportedProvenance(specifiers, viaCallableOutput) {
    for (const specifier of specifiers) {
      exportedProvenanceEdges.push({ specifier, viaCallableOutput });
    }
  }
  for (const binding of lexicalModel.exportedBindings) {
    addExportedProvenance(provenance.forBinding(binding), bindingIsCallableSurface(binding));
  }
  for (const expression of lexicalModel.exportedExpressions) {
    addExportedProvenance(
      provenance.forExpression(expression),
      expressionIsCallableSurface(expression),
    );
  }
  for (const definition of lexicalModel.exportedDefinitions) {
    addExportedProvenance(
      provenance.forDefinition(definition),
      definitionIsCallableSurface(definition),
    );
  }
  for (const { specifier, viaCallableOutput } of exportedProvenanceEdges) {
    edges.push({
      exportsAll: false,
      kind: "export",
      specifier,
      viaCallableOutput,
      viaImportedBinding: true,
    });
  }
  return {
    edges,
    functionLikeSpans,
    hasClientRolePermissionLogic,
    hasRpcTransportSetup,
    hasRouteSsrDisabled,
    hasStaticOrmAccess,
    source: sourceFile.text,
  };
}

function importDeclarationIsRuntime(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings || isNamespaceImport(bindings)) return Boolean(bindings);
  return (
    isNamedImports(bindings) &&
    (bindings.elements.length === 0 || bindings.elements.some((element) => !element.isTypeOnly))
  );
}

function exportDeclarationIsRuntime(node) {
  if (node.isTypeOnly) return false;
  const exports = node.exportClause;
  if (!exports || !isNamedExports(exports)) return true;
  return exports.elements.length === 0 || exports.elements.some((element) => !element.isTypeOnly);
}

function hasOrmAssignmentTarget(node) {
  node = unwrapTransparentExpression(node);
  if (!isObjectLiteralExpression(node)) return false;

  return node.properties.some((property) => {
    if (isShorthandPropertyAssignment(property)) return property.name.text === "orm";
    if (!isPropertyAssignment(property)) return false;
    return (
      staticPropertyName(property.name) === "orm" || hasOrmAssignmentTarget(property.initializer)
    );
  });
}
