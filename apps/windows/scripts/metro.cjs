const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const { parseArgs } = require('node:util');
const { verifyBundle } = require('./verify-bundle.cjs');

// Use the same Metro implementation as this exact Expo SDK, not the CLI's
// separately resolved Metro. Platform discovery may inspect Windows CLI, but
// the versioned lazy-discovery patch prevents launching PowerShell on import.
const expoRequire = createRequire(require.resolve('expo/package.json'));
const Metro = expoRequire('@expo/metro/metro');
const projectRoot = path.resolve(__dirname, '..');

async function ensureWritableTarget(target) {
  // Resolve the nearest existing ancestor before creating any directories.
  let parent = target;
  for (;;) {
    try {
      if ((await fs.realpath(parent)) !== parent) throw new Error(`Symlink output: ${target}`);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      parent = path.dirname(parent);
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
}

async function buildBundle(config, { dev, bundle, sourceMap, assetsDirectory }) {
  await ensureWritableTarget(bundle);
  await ensureWritableTarget(sourceMap);
  const result = await Metro.runBuild(config, {
    entry: path.join(projectRoot, 'index.windows.js'),
    platform: 'windows',
    dev,
    minify: !dev,
    bundleOut: bundle,
    sourceMapOut: sourceMap,
    sourceMap: true,
    sourceMapUrl: path.basename(sourceMap),
    assets: true
  });
  const report = verifyBundle(result.code, result.map, { dev });
  // Match RN's generic scale naming and RNW AssetSourceResolver's local paths.
  // Source maps and test reports stay outside the installed Bundle directory.
  const seen = new Set();
  for (const asset of result.assets) {
    for (const [index, scale] of asset.scales.entries()) {
      const directory = asset.httpServerLocation.replace(/^\//, '').replace(/\.\.\//g, '_');
      const name = `${asset.name}${scale === 1 ? '' : `@${scale}x`}.${asset.type}`;
      const destination = path.resolve(assetsDirectory, directory, name);
      if (!destination.startsWith(`${assetsDirectory}${path.sep}`) || seen.has(destination)) {
        throw new Error(`Unsafe or duplicate Windows asset destination: ${destination}`);
      }
      seen.add(destination);
      await ensureWritableTarget(destination);
      await fs.copyFile(asset.files[index], destination);
    }
  }
  return { ...report, assets: seen.size };
}

async function main() {
  const command = process.argv[2];
  if (!['start', 'qualify', 'bundle'].includes(command)) {
    throw new Error(
      'Usage: node scripts/metro.cjs start|qualify [new-output-directory]|bundle --dev true|false --bundle-output FILE --sourcemap-output FILE --assets-dest DIR'
    );
  }
  // Expo CLI normally installs this adapter before starting Metro. SDK 56's
  // transformer emits packed/full maps that stock Metro cannot serialize.
  if (expoRequire('@expo/metro-config/package.json').version !== '56.0.19') {
    throw new Error('Requalify the SDK-specific Windows Metro source-map adapter.');
  }
  expoRequire(
    '@expo/metro-config/build/serializer/sourceMap'
  ).patchMetroSourceMapStringForPackedMaps();
  const config = await Metro.loadConfig({
    cwd: projectRoot,
    config: path.join(projectRoot, 'metro.config.cjs'),
    maxWorkers: 2
  });
  if (command === 'start') {
    let finish;
    const stopped = new Promise((resolve) => {
      finish = resolve;
    });
    const { httpServer } = await Metro.runServer(config, {
      host: '127.0.0.1',
      port: Number(process.env.RCT_METRO_PORT || 8081),
      onClose: () => finish()
    });
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      httpServer.close((error) => {
        if (error) {
          console.error(error);
          process.exitCode = 1;
        }
      });
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    const bundlePath = path
      .relative(
        config.server.unstable_serverRoot || config.projectRoot,
        path.join(projectRoot, 'index.windows')
      )
      .split(path.sep)
      .join('/');
    console.log(
      `Windows Metro ready: ${JSON.stringify({ port: httpServer.address().port, bundlePath })}`
    );
    await stopped;
    process.removeListener('SIGINT', close);
    process.removeListener('SIGTERM', close);
    return;
  }
  if (command === 'bundle') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        dev: { type: 'string' },
        'bundle-output': { type: 'string' },
        'sourcemap-output': { type: 'string' },
        'assets-dest': { type: 'string' }
      }
    });
    if (
      !['true', 'false'].includes(values.dev) ||
      !values['bundle-output'] ||
      !values['sourcemap-output'] ||
      !values['assets-dest']
    ) {
      throw new Error(
        'bundle requires --dev true|false, --bundle-output, --sourcemap-output, --assets-dest'
      );
    }
    console.log(
      JSON.stringify(
        await buildBundle(config, {
          dev: values.dev === 'true',
          bundle: path.resolve(values['bundle-output']),
          sourceMap: path.resolve(values['sourcemap-output']),
          assetsDirectory: path.resolve(values['assets-dest'])
        }),
        null,
        2
      )
    );
    return;
  }
  const outputRoot = path.resolve(process.argv[3] || path.join(projectRoot, 'artifacts'));
  await ensureWritableTarget(outputRoot);
  // Never replace an earlier qualification run.
  await fs.mkdir(outputRoot);
  const results = [];
  for (const dev of [true, false]) {
    const mode = dev ? 'development' : 'release';
    const out = path.join(outputRoot, `${mode}.bundle`);
    results.push(
      await buildBundle(config, {
        dev,
        bundle: out,
        sourceMap: `${out}.map`,
        assetsDirectory: path.join(outputRoot, mode)
      })
    );
    console.log(`${mode} bundle written to ${out}`);
  }
  await fs.writeFile(
    path.join(outputRoot, 'qualification.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        packages: {
          expo: expoRequire('expo/package.json').version,
          reactNative: require('react-native/package.json').version,
          reactNativeWindows: require('react-native-windows/package.json').version
        },
        results
      },
      null,
      2
    ) + '\n',
    { flag: 'wx' }
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
