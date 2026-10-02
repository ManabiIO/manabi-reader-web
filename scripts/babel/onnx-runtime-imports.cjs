/** @license BSD-3-Clause */
// ORT's published/minified browser bundles contain webpackIgnore:true. Expo's
// dependency collector recognizes only the spaced spelling webpackIgnore: true.
// Preserve ORT's deliberate browser-native import() instead of asking Metro to
// resolve a runtime URL. Never opt an unmarked import or another package out.
const runtimeFile = /(?:^|\/)node_modules\/onnxruntime-web\/dist\/ort[^/]*\.(?:mjs|js)$/;
const webpackIgnore = /^\s*webpackIgnore\s*:\s*true\s*$/;

module.exports = ({ types: t }) => ({
  name: 'manabi-onnx-runtime-imports',
  visitor: {
    'CallExpression|ImportExpression'(importPath, state) {
      const filename = state.filename?.replace(/\\/g, '/');
      if (!filename || !runtimeFile.test(filename)) return;
      const node = importPath.node;
      if (!t.isImportExpression(node) && !t.isImport(node.callee)) return;
      const source = t.isImportExpression(node) ? node.source : node.arguments[0];
      for (const comments of [source?.leadingComments, node.leadingComments, node.innerComments]) {
        for (const comment of comments ?? []) {
          if (webpackIgnore.test(comment.value)) comment.value = ' webpackIgnore: true ';
        }
      }
    }
  }
});
