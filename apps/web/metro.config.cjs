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
const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('mjs');
config.resolver.assetExts.push('onnx', 'wasm', 'epub', 'woff', 'woff2');
config.resolver.extraNodeModules = { $lib: path.resolve(__dirname, 'src/lib') };
config.resolver.resolveRequest = require('./metro-source-resolver.cjs')(
  path.resolve(__dirname, 'src')
);
module.exports = config;
