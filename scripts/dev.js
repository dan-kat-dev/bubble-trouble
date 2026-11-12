/**
 * npm run dev — serve src/ over HTTPS for live development in SketchUp Web.
 *
 * Follows the JSA "Local Development" doc: HTTPS (SketchUp Web is HTTPS, so
 * plain HTTP is blocked as mixed content), CORS headers, and no caching so a
 * reopened panel always gets your latest files.
 *
 * It also writes dist/bubble-trouble-localhost.json: a copy of
 * src/manifest.json whose baseUrl points at this server. Install THAT file
 * (the bare .json, not zipped) once in Extension Manager. After that, edit a
 * file, close and reopen the panel, and the change is live. No reinstall.
 *
 * The dev manifest gets its own id and name ("Bubble Trouble DEV") so it can
 * sit next to an installed release zip without clashing.
 */

import { createServer } from 'node:https';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const PORT = Number(process.env.PORT ?? 9000);
const ROOT = resolve('src');
const CERT = resolve('certs/localhost.pem');
const KEY = resolve('certs/localhost-key.pem');

// ---------------------------------------------------------------------------
// 1. Write the localhost manifest
// ---------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const devManifest = {
  ...manifest,
  id: `${manifest.id}-dev`,
  name: `${manifest.name} DEV`,
  baseUrl: `https://localhost:${PORT}/`,
  commands: Object.fromEntries(
    Object.entries(manifest.commands).map(([id, cmd]) => [id, { ...cmd, title: `${cmd.title} DEV` }])
  ),
};

mkdirSync('dist', { recursive: true });
const devManifestPath = join('dist', `${manifest.id}-localhost.json`);
writeFileSync(devManifestPath, JSON.stringify(devManifest, null, 2) + '\n');

// ---------------------------------------------------------------------------
// 2. HTTPS static server
// ---------------------------------------------------------------------------

if (!existsSync(CERT) || !existsSync(KEY)) {
  console.error('No HTTPS certificate found in certs/. Run "npm run certs" first (see README).');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

const server = createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, (req, res) => {
  // Headers the JSA docs require for a local server.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  let path = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(join(ROOT, path));

  // Never serve anything outside src/.
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    console.log(`404 ${path}`);
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, 'localhost', () => {
  console.log(`Serving src/ at https://localhost:${PORT}/`);
  console.log(`Dev manifest: ${devManifestPath}  (install this bare .json once in Extension Manager)`);
});
