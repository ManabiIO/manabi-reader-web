/** @license BSD-3-Clause
 * Import only the requested icon modules before Metro collects dependencies.
 * This is a build optimization, not a runtime icon-name substitution.
 */
const fs = require('node:fs');
const path = require('node:path');
let lucide;
function lucideModules() {
  if (lucide) return lucide;
  const root = path.dirname(require.resolve('lucide-react/package.json'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, packageJson.module), 'utf8');
  const mappings = new Map();
  for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]\.\/icons\/([^'"]+)['"]/g)) {
    for (const member of match[1].split(',')) {
      const exported = member.trim().match(/^default\s+as\s+(\w+)$/)?.[1];
      if (exported) mappings.set(exported, `lucide-react/dist/esm/icons/${match[2]}`);
    }
  }
  return lucide = mappings;
}
module.exports = ({ types: t }) => ({ name: 'manabi-modular-icons', visitor: { ImportDeclaration(importPath) {
  const node = importPath.node;
  if (node.importKind === 'type' || !['lucide-react', '@phosphor-icons/react'].includes(node.source.value)) return;
  const next = [], kept = [];
  for (const specifier of node.specifiers) {
    if (!t.isImportSpecifier(specifier) || specifier.importKind === 'type') { kept.push(specifier); continue; }
    const name = specifier.imported.name;
    if (node.source.value === 'lucide-react') {
      const target = lucideModules().get(name);
      if (target) next.push(t.importDeclaration([t.importDefaultSpecifier(specifier.local)], t.stringLiteral(target))); else kept.push(specifier);
    } else {
      const file = name.replace(/Icon$/, '');
      const target = `@phosphor-icons/react/dist/csr/${file}`;
      try { const root = path.dirname(require.resolve('@phosphor-icons/react')); if (!fs.existsSync(path.join(root, 'csr', file + '.es.js'))) { kept.push(specifier); continue; } next.push(t.importDeclaration([t.importSpecifier(specifier.local, specifier.imported)], t.stringLiteral(target))); } catch { kept.push(specifier); }
    }
  }
  if (!next.length) return;
  if (kept.length) next.push(t.importDeclaration(kept, node.source));
  importPath.replaceWithMultiple(next);
} } });
