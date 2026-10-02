const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('mjs');
config.resolver.assetExts.push('onnx', 'wasm', 'epub', 'woff', 'woff2');
config.resolver.extraNodeModules = { '$lib': path.resolve(__dirname, 'src/lib') };
config.resolver.resolveRequest = require('./metro-source-resolver.cjs')(path.resolve(__dirname, 'src'));
module.exports = config;
