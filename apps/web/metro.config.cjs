const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('mjs');
config.resolver.assetExts.push('onnx', 'wasm', 'epub');
config.resolver.extraNodeModules = { '$lib': path.resolve(__dirname, 'src/lib') };
module.exports = config;
