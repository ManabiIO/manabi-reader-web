/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRequire = createRequire(path.resolve(here, '../../apps/windows/package.json'));
const rnwRequire = createRequire(appRequire.resolve('react-native-windows/package.json'));
const installed = path.dirname(rnwRequire.resolve('@react-native-windows/cli/package.json'));
const upstream = JSON.parse(await readFile(path.join(here, 'upstream.json'), 'utf8'));
const patch = path.join(here, 'react-native-windows-cli-0.85.0.patch');
const work = await mkdtemp(path.join(tmpdir(), 'reader-windows-cli-contract-'));

test('lazy discovery applies to exactly the reviewed RNW CLI bytes', async () => {
  assert.equal(
    JSON.parse(await readFile(path.join(installed, 'package.json'))).version,
    upstream.version
  );
  for (const name of Object.keys(upstream.files)) {
    await mkdir(path.dirname(path.join(work, name)), { recursive: true });
    await copyFile(path.join(installed, name), path.join(work, name));
  }
  execFileSync('git', ['apply', '--reverse', patch], { cwd: work });
  for (const [name, hash] of Object.entries(upstream.files)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(work, name)))
        .digest('hex'),
      hash,
      name
    );
  }
  execFileSync('git', ['apply', '--check', patch], { cwd: work });
  execFileSync('git', ['apply', patch], { cwd: work });
});

async function loadHealth(platform, discovery) {
  let discoveries = 0;
  const commands = [];
  const exports = {};
  const mocks = {
    path,
    '../../utils/pathHelpers': { resolveRnwRoot: () => '/rnw' },
    execa: async (command) => {
      commands.push(command);
      return { exitCode: 0 };
    },
    '@react-native-windows/find-dotnet-tools': {
      findPowerShell: () => {
        discoveries++;
        return discovery();
      }
    },
    './healthCheckList': { HealthCheckList: [[false, 'test-dependency', 'Test dependency']] }
  };
  vm.runInNewContext(
    await readFile(
      path.join(installed, 'lib-commonjs/commands/healthCheck/healthChecks.js'),
      'utf8'
    ),
    {
      exports,
      require: (name) => {
        assert.ok(name in mocks, name);
        return mocks[name];
      },
      process: { platform, cwd: () => '/app' }
    }
  );
  return { exports, commands, discoveries: () => discoveries };
}

test('platform discovery on non-Windows never requires PowerShell', async () => {
  const health = await loadHealth('darwin', () => {
    throw new Error('No PowerShell');
  });
  assert.equal(health.exports.getHealthChecks(), undefined);
  assert.equal(health.discoveries(), 0);
  // Also execute the real RNW config, including both patched CLI modules.
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `
    const config = require(${JSON.stringify(appRequire.resolve('react-native-windows/react-native.config.js'))});
    console.log(config.platforms.windows.npmPackageName);
  `
    ],
    { encoding: 'utf8' }
  );
  assert.equal(output.trim(), 'react-native-windows');
});

test('Windows diagnostics discover PowerShell on first use and reuse it', async () => {
  const health = await loadHealth('win32', () => 'C:\\tools\\pwsh.exe');
  const check = health.exports.getHealthChecks()[0].healthchecks[0];
  assert.equal(health.discoveries(), 0);
  assert.equal((await check.getDiagnostics()).needsToBeFixed, false);
  assert.equal((await check.getDiagnostics()).needsToBeFixed, false);
  assert.equal(health.discoveries(), 1);
  assert.equal(health.commands.length, 2);
  assert.ok(health.commands.every((value) => value.startsWith('"C:\\tools\\pwsh.exe"')));
});

test('missing PowerShell remains a visible failed diagnostic and manual repair', async () => {
  const health = await loadHealth('win32', () => {
    throw new Error('No PowerShell');
  });
  const check = health.exports.getHealthChecks()[0].healthchecks[0];
  assert.equal((await check.getDiagnostics()).needsToBeFixed, true);
  const messages = [];
  let failed = false;
  await check.runAutomaticFix({
    loader: {
      fail: () => {
        failed = true;
      },
      succeed: () => assert.fail('Unexpected success')
    },
    logManualInstallation: (message) => messages.push(message)
  });
  assert.equal(failed, true);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /Error finding PowerShell/);
  assert.equal(health.commands.length, 0);
});

test('running a Windows script still fails when PowerShell cannot be found', async () => {
  let discoveries = 0;
  const exports = {};
  const mocks = {
    child_process: { spawn: () => assert.fail('Must not launch a missing tool') },
    ora: () => assert.fail('Must discover PowerShell before spinning'),
    'cli-spinners': {},
    chalk: {},
    '@react-native-windows/telemetry': {},
    '@react-native-windows/find-dotnet-tools': {
      findPowerShell: () => {
        discoveries++;
        throw new Error('No PowerShell');
      }
    }
  };
  vm.runInNewContext(
    await readFile(path.join(installed, 'lib-commonjs/utils/commandWithProgress.js'), 'utf8'),
    {
      exports,
      require: (name) => {
        assert.ok(name in mocks, name);
        return mocks[name];
      }
    }
  );
  assert.equal(discoveries, 0);
  await assert.rejects(
    exports.runPowerShellScriptFunction('Check', '', 'Test', false, 'TestFailure'),
    /No PowerShell/
  );
  assert.equal(discoveries, 1);
});

console.log(`Retained Windows CLI patch evidence: ${work}`);
