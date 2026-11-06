const process = require('node:process');
// Preserve the existing optional-video build flag during the Expo migration.
// Normalize before Metro starts transform workers so client code receives only
// Expo's documented EXPO_PUBLIC constant. Explicit Expo values take precedence.
if (
  process.env.EXPO_PUBLIC_ENABLE_VIDEO_LEARNING === undefined &&
  process.env.VITE_ENABLE_VIDEO_LEARNING !== undefined
)
  process.env.EXPO_PUBLIC_ENABLE_VIDEO_LEARNING = process.env.VITE_ENABLE_VIDEO_LEARNING;
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const fs = require('node:fs');
const config = getDefaultConfig(__dirname);
// Metro persists transformed public constants between consecutive exports.
// Keep default and video-enabled qualification builds in distinct cache namespaces.
config.cacheVersion = `${config.cacheVersion ?? ''}:video-learning=${process.env.EXPO_PUBLIC_ENABLE_VIDEO_LEARNING === 'true'}`;
config.cacheVersion += `:edition=${process.env.READER_EDITION ?? 'default'}:provider=${process.env.READER_PROVIDER_ENTRY ?? 'bundled'}`;
config.cacheVersion += `:provider-input=${process.env.READER_PROVIDER_FINGERPRINT ?? 'public'}`;
config.resolver.sourceExts.push('mjs');
config.resolver.assetExts.push('onnx', 'wasm', 'epub', 'woff', 'woff2');
config.resolver.extraNodeModules = {
  $lib: path.resolve(__dirname, 'src/lib'),
  $reader: path.resolve(__dirname, 'src')
};
// Private composition resolves the same React/Expo installation as its pinned
// shared app. It must not require a second native module dependency graph.
config.resolver.nodeModulesPaths = [
  path.join(__dirname, 'node_modules'),
  path.resolve(__dirname, '../../node_modules')
];
const resolveSource = require('./metro-source-resolver.cjs')(path.resolve(__dirname, 'src'));
let providerEntry;
let productEntry;
if (process.env.READER_EDITION === 'manabi') {
  const configured = process.env.READER_PROVIDER_ENTRY;
  if (!configured || !path.isAbsolute(configured))
    throw new Error('A private dictionary provider entry is required.');
  providerEntry = fs.realpathSync(configured);
  if (!fs.statSync(providerEntry).isFile() || providerEntry.startsWith(__dirname + path.sep))
    throw new Error('The private provider entry must be a file outside the public app.');
  config.watchFolders = [...(config.watchFolders ?? []), path.dirname(providerEntry)];
  if (process.env.READER_PRODUCT_ENTRY) {
    productEntry = fs.realpathSync(process.env.READER_PRODUCT_ENTRY);
    if (!fs.statSync(productEntry).isFile() || productEntry.startsWith(__dirname + path.sep))
      throw new Error('The private product entry must be outside the public app.');
    config.watchFolders.push(path.dirname(productEntry));
    config.cacheVersion += `:product=${productEntry}`;
  }
}
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@reader-ui/'))
    return resolveSource(
      context,
      path.join(__dirname, 'src/shared-ui', moduleName.slice('@reader-ui/'.length)),
      platform
    );
  if (
    providerEntry &&
    context.originModulePath === path.join(__dirname, 'src/lib/search/dictionary-runtime.ts') &&
    moduleName === './dictionary-provider-selection'
  )
    return { type: 'sourceFile', filePath: providerEntry };
  if (
    productEntry &&
    context.originModulePath.startsWith(path.join(__dirname, 'src') + path.sep) &&
    moduleName === '../product/ReaderExtensions'
  )
    return { type: 'sourceFile', filePath: productEntry };
  return resolveSource(context, moduleName, platform);
};
module.exports = config;
