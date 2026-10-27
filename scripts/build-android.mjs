#!/usr/bin/env node
/**
 * Builds the web app and stages it as Android assets, then (optionally) builds the APK.
 *   node scripts/build-android.mjs            stage assets only
 *   node scripts/build-android.mjs --apk      + gradle assembleDebug (+ unit tests)
 *   node scripts/build-android.mjs --release  + gradle assembleRelease (needs signing config)
 * Requires ANDROID_HOME (or android/local.properties) for the APK steps.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const www = path.join(androidDir, 'app', 'build', 'generated', 'gameu-assets', 'www');
const wantApk = process.argv.includes('--apk') || process.argv.includes('--release');
const release = process.argv.includes('--release');

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
await fs.rm(www, { recursive: true, force: true });
await copyDir(path.join(root, 'dist', 'public'), www);
await copyDir(path.join(root, 'dist', 'games'), path.join(www, 'games'));
await fs.copyFile(path.join(root, 'dist', 'THIRD-PARTY-LICENSES.txt'), path.join(www, 'THIRD-PARTY-LICENSES.txt'));
console.log(`Android assets staged → ${path.relative(root, www)}`);

if (wantApk) {
  const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const tasks = release
    ? ['testReleaseUnitTest', 'lintRelease', 'assembleRelease', 'bundleRelease']
    : ['testDebugUnitTest', 'lintDebug', 'assembleDebug'];
  execFileSync(gradlew, ['--no-daemon', ...tasks], { cwd: androidDir, stdio: 'inherit' });
  const variant = release ? 'release' : 'debug';
  const apkDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant);
  const apk = (await fs.readdir(apkDir)).find((f) => f.endsWith('.apk'));
  if (!apk) throw new Error(`No APK found in ${apkDir}`);
  const unsigned = apk.includes('unsigned');
  const out = path.join(root, 'release', 'android');
  await fs.mkdir(out, { recursive: true });
  const dest = path.join(out, `Gameu-${variant}${unsigned ? '-unsigned' : ''}.apk`);
  await fs.copyFile(path.join(apkDir, apk), dest);
  console.log(`APK ready → ${path.relative(root, dest)}`);
  if (release) {
    const aab = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
    await fs.copyFile(aab, path.join(out, 'Gameu-release.aab'));
    console.log(`App bundle (Google Play) → release/android/Gameu-release.aab`);
    if (unsigned) console.warn('⚠ Release is UNSIGNED: set GAMEU_KEYSTORE_* or android/keystore.properties (see docs/ANDROID-RELEASE.md).');
  }
}
