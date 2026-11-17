/**
 * npm run desktop:link: points SketchUp desktop at this repo for development.
 *
 * Writes a one-line bubble_trouble_dev.rb into every SketchUp Plugins folder it
 * finds. That file loads ruby/bubble_trouble.rb straight from the repo, so Ruby
 * edits only need a SketchUp restart. With no bundled html in the repo, the
 * dialog loads the Vite dev server (npm run dev) and hot-reloads the app.
 *
 * To undo, delete bubble_trouble_dev.rb from the Plugins folder.
 * Don't also have the .rbz installed: both would register the extension.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = join(process.env.APPDATA ?? '', 'SketchUp');
const plugins = existsSync(root)
  ? readdirSync(root)
      .filter((name) => name.startsWith('SketchUp '))
      .map((name) => join(root, name, 'SketchUp', 'Plugins'))
      .filter((dir) => existsSync(dir))
  : [];

if (plugins.length === 0) {
  console.error(`No SketchUp Plugins folder found under ${root}. Start SketchUp desktop once, then try again.`);
  process.exit(1);
}

const loader = resolve('ruby/bubble_trouble.rb').replaceAll('\\', '/');
for (const dir of plugins) {
  const file = join(dir, 'bubble_trouble_dev.rb');
  writeFileSync(file, `# Dev link to the Bubble Trouble repo (npm run desktop:link)\nload ${JSON.stringify(loader)}\n`);
  console.log(`Wrote ${file}`);
}
