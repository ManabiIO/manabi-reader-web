/** @license BSD-3-Clause */
const fs = require('node:fs');
const path = require('node:path');
/** NodeNext-style .js specifiers in retained TS source need extension substitution.
 * Preserve Metro's real JS/platform resolution first. Never rewrite dependencies.
 * https://docs.expo.dev/guides/customizing-metro/#aliases
 */
module.exports = function sourceResolver(sourceRoot) {
  const root = path.resolve(sourceRoot) + path.sep;
  return (context, moduleName, platform) => {
    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch (original) {
      const origin = context.originModulePath;
      if (!origin?.startsWith(root) || !/^\.\.?\//.test(moduleName) || !moduleName.endsWith('.js'))
        throw original;
      const base = path.resolve(path.dirname(origin), moduleName.slice(0, -3));
      if (!base.startsWith(root)) throw original;
      for (const extension of ['.ts', '.tsx']) {
        if (fs.existsSync(base + extension))
          return context.resolveRequest(context, moduleName.slice(0, -3), platform);
      }
      throw original;
    }
  };
};
