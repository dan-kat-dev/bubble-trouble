/**
 * npm run zip: builds, then packs dist/extension/ into
 * dist/bubble-trouble-<version>.zip to share.
 *
 * Two rules from the JSA docs that this enforces:
 *   - A zip IGNORES baseUrl and serves files from inside the archive, so the
 *     zipped manifest must use baseUrl "/" (never a server URL).
 *   - Every icon the manifest names must be in the archive, or the install
 *     fails outright.
 * manifest.json ends up at the root of the zip, which is also required.
 */

import { createWriteStream, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';

const BUILD = 'dist/extension';

interface Manifest {
  id: string;
  version: string;
  baseUrl: string;
  mainFile: string;
  icon?: string;
  commands?: Record<string, { icon?: string }>;
}

if (!existsSync(join(BUILD, 'manifest.json'))) {
  console.error(`No build found in ${BUILD}/. Run "npm run build" first.`);
  process.exit(1);
}

const manifest: Manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8'));

// ---------------------------------------------------------------------------
// 1. Validate
// ---------------------------------------------------------------------------

const problems: string[] = [];

if (manifest.baseUrl !== '/') {
  problems.push(`baseUrl must be "/" in a zipped manifest (got "${manifest.baseUrl}").`);
}

const icons = [manifest.icon, ...Object.values(manifest.commands ?? {}).map((c) => c.icon)];
for (const icon of icons) {
  if (icon && !/^https?:\/\//.test(icon) && !existsSync(join(BUILD, icon))) {
    problems.push(`Icon "${icon}" is named in the manifest but missing from the build.`);
  }
}

if (!existsSync(join(BUILD, manifest.mainFile))) {
  problems.push(`mainFile "${manifest.mainFile}" is missing from the build.`);
}

if (problems.length) {
  console.error('Not zipping:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Zip
// ---------------------------------------------------------------------------

const outPath = join('dist', `${manifest.id}-${manifest.version}.zip`);
rmSync(outPath, { force: true });

const output = createWriteStream(outPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Wrote ${outPath} (${archive.pointer()} bytes)`);
  console.log('Install: SketchUp Web > Extensions > Extension Manager, drag the .zip onto the upload area.');
});
archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
// cwd: BUILD puts the build's contents at the zip root, so manifest.json is at the top.
archive.glob('**/*', { cwd: BUILD, dot: false });
await archive.finalize();
