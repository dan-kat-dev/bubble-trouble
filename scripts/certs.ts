/**
 * npm run certs — make the localhost HTTPS certificate the dev server uses.
 *
 * Uses mkcert, as the JSA "Local Development" doc recommends, because its
 * certificates are trusted by your browser (no warnings, and the extension
 * iframe loads). This only creates the cert files. Trusting mkcert's local
 * CA is a one-time step you run yourself: `mkcert -install` (see README).
 */

import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('certs', { recursive: true });

const result = spawnSync(
  'mkcert',
  ['-key-file', 'certs/localhost-key.pem', '-cert-file', 'certs/localhost.pem', 'localhost', '127.0.0.1', '::1'],
  { stdio: 'inherit', shell: process.platform === 'win32' }
);

if (result.error || result.status !== 0) {
  console.error('\nmkcert failed or is not installed. Install it (Windows: winget install FiloSottile.mkcert),');
  console.error('run "mkcert -install" once, then run "npm run certs" again.');
  process.exit(1);
}
