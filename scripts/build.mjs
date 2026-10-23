#!/usr/bin/env node
/**
 * Builds Gameu into dist/:
 *   dist/server/server.cjs        Node server (single bundled file)
 *   dist/public/{host,c,sdk,legal} TV host, phone controller, game SDK, static pages
 *   dist/games/<id>/               bundled games
 * Usage: node scripts/build.mjs [--watch]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

/** Older smart-TV browsers: keep syntax conservative. */
const WEB_TARGET = ['es2019', 'chrome70', 'firefox70', 'safari15'];

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function copyDir(from, to, filter = () => true) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dst, filter);
    else if (filter(src)) await copyFile(src, dst);
  }
}

async function gameIds() {
  const entries = await fs.readdir(path.join(root, 'games'), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function copyStatic() {
  const pub = path.join(dist, 'public');
  await copyFile(path.join(root, 'src/host/index.html'), path.join(pub, 'host/index.html'));
  await copyFile(path.join(root, 'src/host/host.css'), path.join(pub, 'host/host.css'));
  for (const f of ['index.html', 'controller.css', 'manifest.webmanifest', 'icon.svg']) {
    await copyFile(path.join(root, 'src/controller', f), path.join(pub, 'c', f));
  }
  await copyFile(path.join(root, 'src/sdk/game-base.css'), path.join(pub, 'sdk/game-base.css'));
  await copyDir(path.join(root, 'src/public'), pub);
  // Game assets (everything except TypeScript sources).
  await copyDir(path.join(root, 'games'), path.join(dist, 'games'), (f) => !f.endsWith('.ts'));
}

async function buildOptions() {
  const games = [];
  for (const id of await gameIds()) {
    try {
      await fs.access(path.join(root, 'games', id, 'main.ts'));
      games.push({ in: path.join(root, 'games', id, 'main.ts'), out: path.join('games', id, 'main') });
    } catch {
      /* no TS entry */
    }
  }
  const common = { bundle: true, logLevel: 'info', legalComments: 'none', sourcemap: watch ? 'inline' : false };
  return [
    {
      ...common,
      entryPoints: [path.join(root, 'src/server/main.ts')],
      outfile: path.join(dist, 'server/server.cjs'),
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      // Optional native accelerators of `ws`; it falls back to pure JS without them.
      external: ['bufferutil', 'utf-8-validate'],
    },
    {
      ...common,
      entryPoints: [
        { in: path.join(root, 'src/host/main.ts'), out: 'public/host/host' },
        { in: path.join(root, 'src/controller/main.ts'), out: 'public/c/controller' },
        { in: path.join(root, 'src/sdk/standalone.ts'), out: 'public/sdk/gameu' },
        ...games,
      ],
      outdir: dist,
      platform: 'browser',
      format: 'iife',
      target: WEB_TARGET,
      minify: !watch,
    },
  ];
}

/** Collects license texts of every npm package that ends up in a bundle (MIT etc. require the notice). */
async function writeThirdPartyLicenses(metafiles) {
  const pkgDirs = new Set();
  for (const meta of metafiles) {
    for (const input of Object.keys(meta.inputs)) {
      const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
      if (m) pkgDirs.add(path.join(root, m[1]));
    }
  }
  const sections = [];
  for (const dir of [...pkgDirs].sort()) {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    const files = await fs.readdir(dir);
    const licenseFile = files.find((f) => /^(license|licence|copying)(\.|$)/i.test(f));
    const text = licenseFile ? (await fs.readFile(path.join(dir, licenseFile), 'utf8')).trim() : `License: ${pkg.license ?? 'unknown'}`;
    sections.push(`${pkg.name}@${pkg.version} (${pkg.license ?? 'unknown'})\n${'-'.repeat(60)}\n${text}`);
  }
  await fs.writeFile(path.join(dist, 'THIRD-PARTY-LICENSES.txt'), `Gameu bundles the following open-source packages.\n\n${sections.join('\n\n\n')}\n`);
}

async function main() {
  await fs.rm(dist, { recursive: true, force: true });
  await copyStatic();
  const configs = await buildOptions();
  if (!watch) {
    const results = await Promise.all(configs.map((c) => esbuild.build({ ...c, metafile: true })));
    await writeThirdPartyLicenses(results.map((r) => r.metafile));
    console.log('Build complete → dist/');
    return;
  }
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  let pending = null;
  for (const dir of ['src/host', 'src/controller', 'src/public', 'src/sdk', 'games']) {
    fsWatch(path.join(root, dir), { recursive: true }, (_e, file) => {
      if (!file || file.endsWith('.ts')) return;
      clearTimeout(pending);
      pending = setTimeout(() => copyStatic().catch((e) => console.error(e)), 100);
    });
  }
  // Give esbuild a moment to emit the first server bundle, then run it with auto-restart.
  await new Promise((r) => setTimeout(r, 500));
  const server = spawn(process.execPath, ['--watch', path.join(dist, 'server/server.cjs')], { stdio: 'inherit', env: process.env });
  const stop = () => {
    server.kill();
    Promise.all(contexts.map((c) => c.dispose())).finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
