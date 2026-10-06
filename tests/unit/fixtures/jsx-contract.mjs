/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import ts from 'typescript';

const printer = ts.createPrinter({ removeComments: true });

export function parseTsx(source, fileName = 'contract.tsx') {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  assert.deepEqual(file.parseDiagnostics, [], `${fileName} must parse without errors`);
  return file;
}

function matchingNodes(root, matches) {
  const result = [];
  function visit(node) {
    if (matches(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return result;
}

function openingElement(node) {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

export function jsxElements(root, tagName) {
  return matchingNodes(
    root,
    (node) =>
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      openingElement(node).tagName.getText() === tagName
  );
}

function jsxAttributeValue(node, name) {
  const attribute = openingElement(node).attributes.properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.getText() === name
  );
  return attribute?.initializer;
}

export function jsxAttributeText(node, name) {
  const value = jsxAttributeValue(node, name);
  const expression = value && ts.isJsxExpression(value) ? value.expression : value;
  return expression && ts.isStringLiteral(expression) ? expression.text : undefined;
}

export function jsxAttributeExpressionText(node, name) {
  const value = jsxAttributeValue(node, name);
  const expression = value && ts.isJsxExpression(value) ? value.expression : undefined;
  return expression
    ? printer.printNode(ts.EmitHint.Expression, expression, node.getSourceFile())
    : undefined;
}

export function hasControllerProperty(root, name) {
  return (
    matchingNodes(
      root,
      (node) =>
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'c' &&
        node.name.text === name
    ).length > 0
  );
}
