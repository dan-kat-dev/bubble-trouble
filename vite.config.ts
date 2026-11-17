/**
 * Vite config.
 *
 * Dev: serves the app at https://localhost:9000/ (the baseUrl in the dev
 * manifest) with hot reload. HTTPS is required because SketchUp Web is HTTPS
 * and browsers block mixed content. Certificates come from `npm run certs`.
 * Without them we fall back to plain HTTP: fine for the fake model in a normal
 * browser, but SketchUp won't load it.
 *
 * Build: writes the extension to dist/extension/ with relative paths, because
 * a zip is served from wherever SketchUp unpacks it.
 *
 * Desktop build (--mode desktop): one self-contained dist/desktop/index.html
 * for the Ruby extension's HtmlDialog. Everything is inlined because the
 * dialog loads it from a file:// path, where Chromium blocks module scripts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

const PORT = 9000;
const CERT = 'certs/localhost.pem';
const KEY = 'certs/localhost-key.pem';
const hasCerts = existsSync(CERT) && existsSync(KEY);

export default defineConfig(({ command, mode }) => {
  const desktop = mode === 'desktop';
  if (command === 'serve' && !hasCerts) {
    console.warn(
      '\n  No certs/ found, serving plain HTTP. SketchUp needs HTTPS: run "npm run certs" (see README).\n'
    );
  }

  return {
    plugins: desktop ? [vue(), viteSingleFile()] : [vue()],
    base: './',
    // The web manifest and icon aren't part of the desktop build.
    publicDir: desktop ? false : 'public',
    build: {
      outDir: desktop ? 'dist/desktop' : 'dist/extension',
      emptyOutDir: true,
    },
    server: {
      host: 'localhost',
      port: PORT,
      strictPort: true,
      https: hasCerts ? { cert: readFileSync(CERT), key: readFileSync(KEY) } : undefined,
      // SketchUp's page fetches our icon cross-origin, so allow CORS (JSA docs).
      cors: true,
    },
  };
});
