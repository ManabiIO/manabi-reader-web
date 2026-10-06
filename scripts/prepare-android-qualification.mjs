/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const marker = '// Manabi packaged-reader instrumentation (generated, test-only)';

/** Attach tests to Expo's generated Android project, never to production app sources. */
export async function prepareAndroidQualification({
  androidDirectory = path.join(root, 'apps/web/android'),
  fixtureDirectory = path.join(root, 'tests/android')
} = {}) {
  const app = path.join(androidDirectory, 'app');
  const buildFile = path.join(app, 'build.gradle');
  let build = await fs.readFile(buildFile, 'utf8');
  if (!/applicationId\s+["']io\.manabi\.reader["']/.test(build))
    throw new Error(
      'Expected the generated io.manabi.reader Android app. Run Android-only Expo prebuild first.'
    );
  if (/testBuildType\s+["'](?!release["'])/.test(build))
    throw new Error('Refusing to replace a different instrumentation build type.');
  if (
    /testInstrumentationRunner\s+["'](?!androidx\.test\.runner\.AndroidJUnitRunner["'])/.test(build)
  )
    throw new Error('Refusing to replace an existing instrumentation runner.');
  const javaDir = path.join(app, 'src/androidTest/java/io/manabi/reader/qualification');
  const assetDir = path.join(app, 'src/androidTest/assets/manabi-qualification');
  await fs.mkdir(javaDir, { recursive: true });
  await fs.mkdir(assetDir, { recursive: true });
  await fs.copyFile(
    path.join(fixtureDirectory, 'PackagedReaderTest.java'),
    path.join(javaDir, 'PackagedReaderTest.java')
  );
  await fs.copyFile(path.join(fixtureDirectory, 'probe.js'), path.join(assetDir, 'probe.js'));
  const version = JSON.parse(
    await fs.readFile(path.join(root, 'apps/web/src/lib/search/dictionary-providers/manabitan/version.json'), 'utf8')
  );
  if (version.repository !== 'ManabiIO/manabitan' || !/^[a-f0-9]{40}$/.test(version.revision))
    throw new Error('Invalid pinned Manabitan revision.');
  await fs.writeFile(
    path.join(assetDir, 'config.json'),
    JSON.stringify({ dictionaryRevision: version.revision }) + '\n'
  );
  await fs.writeFile(
    path.join(app, 'reader-qualification.gradle'),
    `${marker}
// These libraries and assets are confined to the test APK. The target remains
// the ordinary non-debuggable, embedded release APK with its original host.
android {
    testBuildType "release"
    defaultConfig {
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }
}
dependencies {
    androidTestImplementation "androidx.test:core:1.7.0"
    androidTestImplementation "androidx.test:runner:1.7.0"
    androidTestImplementation "androidx.test.ext:junit:1.3.0"
}
`
  );
  if (!build.includes(marker)) {
    build += `\n${marker}\napply from: file("reader-qualification.gradle")\n`;
    await fs.writeFile(buildFile, build);
  } else if (!build.includes('apply from: file("reader-qualification.gradle")')) {
    throw new Error('Instrumentation marker exists without its expected Gradle include.');
  }
  return {
    androidDirectory,
    buildType: 'release',
    testClass: 'io.manabi.reader.qualification.PackagedReaderTest'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2)
    throw new Error('Usage: node scripts/prepare-android-qualification.mjs');
  console.log(JSON.stringify(await prepareAndroidQualification(), null, 2));
}
