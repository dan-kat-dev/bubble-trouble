# Bubble Trouble

A visual outliner for SketchUp: see, search and select everything in your model
at a glance, without double-clicking ten levels deep.

Built on the [SketchUp JavaScript API](https://developer.trimble.com/docs/sketchup/jsa/welcome/)
(SketchUp Web, JSA Labs). Started from the `sidebar-panel` example in
[sketchup-js-api-tutorials](https://github.com/SketchUp/sketchup-js-api-tutorials) (MIT).

## Layout

```
src/                 everything that ships: served in dev, zipped for release
  manifest.json      the release manifest (baseUrl "/")
  index.html         thin shell: stylesheet, SDK, then bubble-trouble.js
  bubble-trouble.js  extension logic
  bubble-trouble.css
  bubble-trouble.svg icon
scripts/
  certs.js           npm run certs: make the localhost HTTPS cert (mkcert)
  dev.js             npm run dev: HTTPS server + writes the dev manifest
  zip.js             npm run zip: validate + pack src/ into dist/
dist/                generated output (gitignored)
```

## One-time setup

1. Install [mkcert](https://github.com/FiloSottile/mkcert) and trust its local CA:
   ```bash
   winget install FiloSottile.mkcert
   mkcert -install
   ```
2. Install deps and make the cert:
   ```bash
   npm install
   npm run certs
   ```

## Develop (live, no re-uploading)

```bash
npm run dev
```

This serves `src/` at `https://localhost:9000/` and writes
`dist/bubble-trouble-localhost.json`.

1. Open [SketchUp Web JSA Labs](https://jsa-labs.sketchup.com) and a model.
2. **Extensions > Extension Manager**, then drag in
   `dist/bubble-trouble-localhost.json` (the bare `.json`, **not** zipped). You
   only do this once.
3. **Extensions > Bubble Trouble DEV** opens the sidebar panel.
4. Edit anything in `src/`, close and reopen the panel, and the change is live.

You only need to reinstall the dev manifest when `src/manifest.json` itself
changes (new commands, menus, window settings).

If the panel is blank, open `https://localhost:9000/` in the same browser first.
It should load without a certificate warning. If it warns, `mkcert -install`
didn't take.

## Share (zip)

```bash
npm run zip
```

This writes `dist/bubble-trouble-<version>.zip`. Anyone can drag it into
Extension Manager. Bump `version` in `src/manifest.json` for each release.

## Notes

- The sidebar is SketchUp's own docked inspector column, so `width` and
  position are set by SketchUp, not by the manifest. Only `height` applies.
- A zip ignores `baseUrl`, and a bare `.json` honors it. That's why there are
  two manifests, and why the dev one is generated instead of hand-maintained.
