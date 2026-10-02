/** @license BSD-3-Clause */
// ORT's published/minified browser bundles contain webpackIgnore:true. Expo's
// dependency collector recognizes only the spaced spelling webpackIgnore: true.
// Preserve ORT's deliberate browser-native import() instead of asking Metro to
// resolve a runtime URL. Never opt an unmarked import or another package out.
const runtimeFile = /(?:^|\/)node_modules\/onnxruntime-web\/dist\/ort[^/]*\.(?:mjs|js)$/;
const embeddedWasmFile =
  /(?:^|\/)node_modules\/onnxruntime-web\/dist\/ort\.wasm\.bundle(?:\.min)?\.mjs$/;
const webpackIgnore = /^\s*webpackIgnore\s*:\s*true\s*$/;

module.exports = ({ types: t }) => ({
  name: 'manabi-onnx-runtime-imports',
  visitor: {
    MemberExpression(memberPath, state) {
      const filename = state.filename?.replace(/\\/g, '/');
      if (!filename || !embeddedWasmFile.test(filename)) return;
      const node = memberPath.node;
      if (
        !node.computed &&
        t.isMetaProperty(node.object) &&
        node.object.meta.name === 'import' &&
        node.object.property.name === 'meta' &&
        t.isIdentifier(node.property, { name: 'url' })
      ) {
        // This exact ORT entry embeds its factory; our single-threaded SwiftF0
        // adapter supplies both model and WASM URLs from the owning document.
        // Metro otherwise rewrites this to an Expo registry absent in module
        // workers. An unavailable optional module URL is valid for this factory;
        // do not fabricate a registry or alter import.meta in application code.
        memberPath.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
      }
    },
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
