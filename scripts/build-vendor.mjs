#!/usr/bin/env node
/*
 * Re-bundles Sapphire (Chrome extensions for the web proxy) into js/vendor/.
 * Only needed when updating Sapphire; the built files are committed, so
 * deploys never run this.
 *
 *   npm install --no-save --legacy-peer-deps @x8r/sapphire@0.1.4 jszip@3.10.1 esbuild@0.28.0
 *   node scripts/build-vendor.mjs
 *
 * (--legacy-peer-deps: Sapphire 0.1.4 lists scramjet-controller ^0.0.13 but is
 *  tested against 0.0.14, which is the version that matches Scramjet 2.0.67.)
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAPPHIRE = dirname(require.resolve('@x8r/sapphire/package.json'));
const version = JSON.parse(readFileSync(join(SAPPHIRE, 'package.json'), 'utf8')).version;
// Sapphire imports the controller; on the page it's already loaded as
// globalThis.$scramjetController, so point the import at the controller's
// own "external" stub that re-exports that global.
const controllerStub = require.resolve('@mercuryworkshop/scramjet-controller');

const banner = `/* @x8r/sapphire ${version} (https://github.com/x8rr/sapphire), bundled by scripts/build-vendor.mjs */`;

await build({
  entryPoints: [join(SAPPHIRE, 'src/index.ts')],
  outfile: join(ROOT, 'js/vendor/sapphire.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  banner: { js: banner },
  alias: { '@mercuryworkshop/scramjet-controller': controllerStub },
  logLevel: 'warning',
});

await build({
  entryPoints: [join(SAPPHIRE, 'src/router/swEntry.ts')],
  outfile: join(ROOT, 'js/vendor/sapphire-sw.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  banner: { js: banner },
  logLevel: 'warning',
});

console.log(`Sapphire ${version} -> js/vendor/sapphire.js, js/vendor/sapphire-sw.js`);
