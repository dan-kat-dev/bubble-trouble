/**
 * Writes dist/bubble-trouble-localhost.json, run by `npm run dev` before Vite.
 *
 * It's a copy of public/manifest.json whose baseUrl points at the Vite dev
 * server. Install THAT file (the bare .json, not zipped) once in Extension
 * Manager. A bare manifest honors baseUrl; a zip ignores it (JSA docs).
 *
 * The dev copy gets its own id and name ("Bubble Trouble DEV") so it can sit
 * next to an installed release zip without clashing.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORT = 9000; // keep in sync with vite.config.ts

interface Command {
  title: string;
  [key: string]: unknown;
}

interface Manifest {
  id: string;
  name: string;
  baseUrl: string;
  commands: Record<string, Command>;
  [key: string]: unknown;
}

const manifest: Manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));

const devManifest: Manifest = {
  ...manifest,
  id: `${manifest.id}-dev`,
  name: `${manifest.name} DEV`,
  baseUrl: `https://localhost:${PORT}/`,
  commands: Object.fromEntries(
    Object.entries(manifest.commands).map(([id, cmd]) => [id, { ...cmd, title: `${cmd.title} DEV` }])
  ),
};

mkdirSync('dist', { recursive: true });
const path = `dist/${manifest.id}-localhost.json`;
writeFileSync(path, JSON.stringify(devManifest, null, 2) + '\n');
console.log(`Dev manifest: ${path}  (install this bare .json once in Extension Manager)`);
