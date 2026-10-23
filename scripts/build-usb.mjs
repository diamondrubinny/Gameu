#!/usr/bin/env node
/**
 * Builds a portable USB folder (mode B): copy `release/usb/Gameu` to the root of a USB drive.
 *
 *   Gameu/
 *     Start-Gameu-Windows.bat     double-click on Windows
 *     Start-Gameu-Mac.command     double-click on macOS
 *     start-gameu-linux.sh        run on Linux (also Raspberry Pi 64-bit)
 *     app/                        built console (dist/)
 *     runtime/<os-arch>/node      official Node.js binaries, SHA-256 verified
 *     data/                       settings + isolated browser profile (created at runtime)
 *
 * Usage: node scripts/build-usb.mjs [--targets=win-x64,linux-x64,linux-arm64,darwin-arm64,darwin-x64] [--node=v22.x.y]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'release', 'usb', 'Gameu');
const cacheDir = path.join(root, '.cache', 'node');
const ALL_TARGETS = ['win-x64', 'linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64'];
const NODE_MAJOR = 22; // LTS line used for the portable runtime

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const targets = (arg('targets') ?? ALL_TARGETS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
for (const t of targets) if (!ALL_TARGETS.includes(t)) throw new Error(`Unknown target ${t}. Valid: ${ALL_TARGETS.join(', ')}`);

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res;
}

async function resolveNodeVersion() {
  const pinned = arg('node');
  if (pinned) return pinned.startsWith('v') ? pinned : `v${pinned}`;
  const index = await (await fetchOk('https://nodejs.org/dist/index.json')).json();
  const latest = index.find((r) => r.version.startsWith(`v${NODE_MAJOR}.`) && r.lts);
  if (!latest) throw new Error(`No LTS release found for Node ${NODE_MAJOR}`);
  return latest.version;
}

/** Downloads (with cache) and verifies against the official SHASUMS256.txt. */
async function download(version, file, sums) {
  const expected = sums.get(file);
  if (!expected) throw new Error(`${file} is not listed in SHASUMS256.txt for ${version}`);
  const dest = path.join(cacheDir, version, file);
  try {
    const cached = await fs.readFile(dest);
    if (sha256(cached) === expected) return dest;
  } catch {
    /* not cached */
  }
  console.log(`  downloading ${file}`);
  const buf = Buffer.from(await (await fetchOk(`https://nodejs.org/dist/${version}/${file}`)).arrayBuffer());
  const actual = sha256(buf);
  if (actual !== expected) throw new Error(`Checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return dest;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function installRuntime(version, target, sums) {
  const dir = path.join(out, 'runtime', target);
  await fs.mkdir(dir, { recursive: true });
  if (target === 'win-x64') {
    const exe = await download(version, 'win-x64/node.exe', sums);
    await fs.copyFile(exe, path.join(dir, 'node.exe'));
  } else {
    const base = `node-${version}-${target}`;
    const archive = await download(version, `${base}.tar.gz`, sums);
    // Extract only the node binary (argument array, no shell).
    execFileSync('tar', ['-xzf', archive, '-C', dir, '--strip-components=2', `${base}/bin/node`]);
    await fs.chmod(path.join(dir, 'node'), 0o755);
    // Ship the Node.js license alongside the binaries.
    const license = path.join(out, 'runtime', 'NODE-LICENSE');
    if (!(await exists(license))) {
      execFileSync('tar', ['-xzf', archive, '-C', path.join(out, 'runtime'), '--strip-components=1', `${base}/LICENSE`]);
      await fs.rename(path.join(out, 'runtime', 'LICENSE'), license);
    }
  }
  console.log(`  ✓ runtime ${target}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

const WINDOWS_BAT = `@echo off
chcp 65001 >nul
title Gameu
cd /d "%~dp0"
set "GAMEU_APP_ROOT=%~dp0app"
set "GAMEU_DATA_DIR=%~dp0data"
echo Starting Gameu... (close this window to stop)
"%~dp0runtime\\win-x64\\node.exe" "%~dp0app\\server\\server.cjs" --kiosk
echo.
echo Gameu stopped.
pause
`;

const POSIX_LAUNCHER = (os) => `#!/bin/sh
# Gameu launcher (${os}). Stop with Ctrl+C.
DIR="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;;
esac
NODE="$DIR/runtime/${os}-$ARCH/node"
if [ ! -f "$NODE" ]; then echo "Missing runtime for ${os}-$ARCH"; exit 1; fi
# USB drives formatted FAT32/exFAT may be mounted without exec permission: run a temp copy instead.
if [ ! -x "$NODE" ]; then
  TMP_NODE="\${TMPDIR:-/tmp}/gameu-node-$ARCH"
  cp "$NODE" "$TMP_NODE" && chmod 700 "$TMP_NODE" && NODE="$TMP_NODE"
fi
export GAMEU_APP_ROOT="$DIR/app"
export GAMEU_DATA_DIR="$DIR/data"
exec "$NODE" "$DIR/app/server/server.cjs" --kiosk
`;

const README = `Gameu — קונסולת משחקים מה־USB
================================

הפעלה
-----
1. חברו את המחשב לטלוויזיה בכבל HDMI.
2. חברו את ה־USB למחשב ופתחו את התיקייה Gameu.
3. הפעילו לפי מערכת ההפעלה:
   • Windows: לחיצה כפולה על Start-Gameu-Windows.bat
     בהפעלה הראשונה Windows עשוי לשאול על גישה לרשת — אשרו "רשתות פרטיות" בלבד.
   • macOS: לחיצה ימנית על Start-Gameu-Mac.command ← "פתיחה" (בפעם הראשונה).
   • Linux / Raspberry Pi (64 ביט): פתחו מסוף בתיקייה והריצו: sh start-gameu-linux.sh
4. מסך הקונסולה נפתח במסך מלא. סרקו את קוד ה־QR בטלפון (באותה רשת Wi‑Fi).
5. לסגירה: Alt+F4 (Windows/Linux) או Cmd+Q (Mac), ואז סגרו את חלון הפקודה.

דרישות
------
• Google Chrome, Microsoft Edge או Chromium מותקן במחשב (אחרת ייפתח הדפדפן הרגיל — לחצו F11 למסך מלא).
• הטלפונים והמחשב באותה רשת. רשת "אורחים" בראוטר חוסמת לפעמים חיבור בין מכשירים.

טלוויזיה חכמה בלי מחשב צמוד (מצב מתקדם)
---------------------------------------
הריצו את Gameu במחשב ברשת עם משתנה סביבה GAMEU_HOST_KEY (לפחות 16 תווים),
ופתחו בדפדפן הטלוויזיה: http://<כתובת-המחשב>:8080/?key=<המפתח>

פרטיות: אין חשבונות ואין שליחת מידע לאינטרנט. ההגדרות נשמרות בתיקייה data.

------------------------------------------------------------
Gameu — game console from a USB drive

1. Connect the computer to the TV with HDMI.
2. Plug in the USB drive and open the Gameu folder.
3. Windows: double-click Start-Gameu-Windows.bat (allow "Private networks" if asked).
   macOS: right-click Start-Gameu-Mac.command → Open (first time only).
   Linux / Raspberry Pi 64-bit: sh start-gameu-linux.sh
4. Scan the QR code on the TV with your phone (same Wi-Fi).
Requires Chrome, Edge or Chromium for full-screen kiosk mode.
`;

async function main() {
  console.log('Building app…');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, 'data'), { recursive: true });
  await copyDir(path.join(root, 'dist'), path.join(out, 'app'));

  const version = await resolveNodeVersion();
  console.log(`Node.js runtime ${version} for: ${targets.join(', ')}`);
  const sumsText = await (await fetchOk(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).text();
  const sums = new Map(sumsText.trim().split('\n').map((l) => { const [hash, file] = l.trim().split(/\s+/); return [file, hash]; }));
  for (const t of targets) await installRuntime(version, t, sums);

  if (targets.includes('win-x64')) await fs.writeFile(path.join(out, 'Start-Gameu-Windows.bat'), WINDOWS_BAT.replace(/\n/g, '\r\n'));
  if (targets.some((t) => t.startsWith('darwin'))) await fs.writeFile(path.join(out, 'Start-Gameu-Mac.command'), POSIX_LAUNCHER('darwin'), { mode: 0o755 });
  if (targets.some((t) => t.startsWith('linux'))) await fs.writeFile(path.join(out, 'start-gameu-linux.sh'), POSIX_LAUNCHER('linux'), { mode: 0o755 });
  await fs.writeFile(path.join(out, 'README.txt'), README);

  // Integrity manifest for the whole folder.
  const lines = [];
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else lines.push(`${sha256(await fs.readFile(p))}  ${path.relative(out, p).split(path.sep).join('/')}`);
    }
  };
  await walk(out);
  await fs.writeFile(path.join(out, 'SHA256SUMS.txt'), lines.sort((a, b) => a.slice(66).localeCompare(b.slice(66))).join('\n') + '\n');

  console.log(`\nUSB folder ready: ${path.relative(root, out)}`);
  console.log('Copy the whole "Gameu" folder to the root of a USB drive (exFAT recommended).');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
