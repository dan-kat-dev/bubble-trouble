/**
 * npm run rbz: builds the desktop app, then packs the SketchUp desktop
 * extension into dist/bubble-trouble-<version>.rbz.
 *
 * An .rbz is just a zip that SketchUp unpacks into its Plugins folder:
 *
 *   bubble_trouble.rb                  loader (from ruby/)
 *   bubble_trouble/main.rb             the Ruby half (from ruby/)
 *   bubble_trouble/html/index.html     the app (from dist/desktop/)
 */

import { createWriteStream, existsSync, readFileSync, rmSync } from 'node:fs';
import { ZipArchive } from 'archiver';

const HTML = 'dist/desktop/index.html';

if (!existsSync(HTML)) {
  console.error(`No desktop build at ${HTML}. Run "npm run build:desktop" first.`);
  process.exit(1);
}

// The Ruby loader has its own VERSION; make sure it matches the manifest.
const version: string = JSON.parse(readFileSync('public/manifest.json', 'utf8')).version;
const rubyVersion = readFileSync('ruby/bubble_trouble.rb', 'utf8').match(/VERSION = '([^']+)'/)?.[1];
if (rubyVersion !== version) {
  console.error(`Version mismatch: public/manifest.json is ${version}, ruby/bubble_trouble.rb is ${rubyVersion}.`);
  process.exit(1);
}

const outPath = `dist/bubble-trouble-${version}.rbz`;
rmSync(outPath, { force: true });

const output = createWriteStream(outPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Wrote ${outPath} (${archive.pointer()} bytes)`);
  console.log('Install: SketchUp > Extensions > Extension Manager > Install Extension, pick the .rbz.');
});
archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory('ruby/', false);
archive.file(HTML, { name: 'bubble_trouble/html/index.html' });
await archive.finalize();
