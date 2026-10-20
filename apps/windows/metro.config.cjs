const { getDefaultConfig } = require('expo/metro-config');
const { makeMetroConfig } = require('@rnx-kit/metro-config');
const path = require('node:path');
const fs = require('node:fs');
const { URL } = require('node:url');

// Compose the installed SDK's Expo config with Microsoft's out-of-tree platform
// resolver. expo-desktop-metro-config@55 targets a different RN/Expo generation.
const expoConfig = getDefaultConfig(__dirname);
const config = makeMetroConfig(expoConfig);
// SDK 56's empty assetPlugins and its URL rewriter override rnx-kit's asset
// defaults during composition. Preserve both: otherwise ../ monorepo asset URLs
// collapse in the client and native development images return 404.
const assetPlugin = require.resolve('@rnx-kit/metro-config/src/assetPlugins/escapeAssetURLs');
const { restoreAssetURL } = require(assetPlugin);
config.transformer.assetPlugins = [...new Set([...config.transformer.assetPlugins, assetPlugin])];
const rewriteRequestUrl = config.server.rewriteRequestUrl;
// New Metro normalizes the URL before routing. Restoring ../ into the pathname
// (the wrapper's old middleware) collapses it again. Carry the path in Metro's
// existing unstable_path query instead, keeping the bundle's release asset names.
config.server.enhanceMiddleware = expoConfig.server.enhanceMiddleware;
config.server.rewriteRequestUrl = (url) => {
  if (url.startsWith('/assets/')) {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname.split('/').includes('@@')) {
      parsed.searchParams.set(
        'unstable_path',
        restoreAssetURL(parsed.pathname).slice('/assets/'.length)
      );
      return rewriteRequestUrl(`/assets${parsed.search}`);
    }
  }
  return rewriteRequestUrl(url);
};
const rnwRoot = fs.realpathSync(path.dirname(require.resolve('react-native-windows/package.json')));
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const directoryPattern = (directory) =>
  new RegExp(`^${directory.split(/[/\\]/).map(escape).join('[/\\\\]')}[/\\\\]`);

// Preserve Expo's exclusions and avoid watching locked/generated MSBuild files.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  directoryPattern(path.join(__dirname, 'windows')),
  directoryPattern(path.join(__dirname, 'artifacts')),
  directoryPattern(path.join(rnwRoot, 'build')),
  directoryPattern(path.join(rnwRoot, 'target')),
  /\.ProjectImports\.zip$/
];
config.resolver.unstable_conditionsByPlatform.windows = ['react-native'];

module.exports = config;
