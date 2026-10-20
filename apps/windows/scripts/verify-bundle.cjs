const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function verifyBundle(code, mapText, { dev }) {
  const map = JSON.parse(mapText);
  assert.ok(
    Array.isArray(map.sources) && map.sources.length > 0,
    'Missing bundle source inventory'
  );
  const sources = map.sources.map((source) => source.replaceAll('\\', '/'));
  for (const file of [
    'Libraries/Core/InitializeCore.js',
    'Libraries/Utilities/Platform.windows.js',
    'Libraries/ReactNative/AppRegistry.js'
  ]) {
    assert.equal(
      sources.filter((source) => source.endsWith(`/react-native-windows/${file}`)).length,
      1,
      file
    );
  }
  assert.equal(
    sources.filter((source) => /\/react-native\/(?:Libraries|src)\//.test(source)).length,
    0,
    'Mobile RN implementation leaked into the Windows host'
  );
  assert.equal(
    new Set(sources.filter((source) => /\/react\/index\.js$/.test(source))).size,
    1,
    'Expected one React instance'
  );
  assert.ok(
    !sources.some((source) =>
      /\/(?:expo-modules-core|@expo\/ui|expo-desktop-stubs)\//.test(source)
    ),
    'Bootstrap must not load unsupported Expo native implementations or stubs'
  );
  if (dev) {
    assert.ok(
      sources.some((source) => source.endsWith('/ReactDevToolsSettingsManager.windows.js')),
      'Development must use real Windows DevTools'
    );
  }
  assert.ok(code.includes('ManabiReaderWindows'), 'AppRegistry registration missing');
  return {
    mode: dev ? 'development' : 'release',
    modules: sources.length,
    bundleSha256: crypto.createHash('sha256').update(code).digest('hex'),
    sourceMapSha256: crypto.createHash('sha256').update(mapText).digest('hex'),
    nativeRuntime: 'unqualified'
  };
}

module.exports = { verifyBundle };
