# Bubble Trouble

A visual outliner for SketchUp, letting intuitively see how big (aka how many faces & edges) each group/component in your model has, as well as navigate, selected, and find them in your model.

This was started at a workshow to try out the new SketchUP JS API:
[SketchUp JavaScript API](https://developer.trimble.com/docs/sketchup/jsa/welcome/)
(SketchUp Web, JSA Labs).

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

## Develop

```bash
npm run dev
```

This serves the app at `https://localhost:9000/` with hot reload, and writes
`dist/bubble-trouble-localhost.json`.

**In SketchUp:**

1. Open [SketchUp Web JSA Labs](https://jsa-labs.sketchup.com) and a model.
2. **Extensions > Extension Manager**, then drag in
   `dist/bubble-trouble-localhost.json`. (You only need to do this once.)
3. **Extensions > Bubble Trouble DEV** opens the sidebar panel.

Panel should hot-reload if you change and save the code (may need to close and re-open panel in SU)

You only need to reinstall the dev manifest when `public/manifest.json` changes.

**Test Outside SU:**
Open `https://localhost:9000/`. Outside SketchUp it uses a fake house model, with buttons to fake deletes, explodes and additions.
Add `?mock` to force the fake model.

## Share (zip)

```bash
npm run zip
```

Builds into `dist/extension/` and writes `dist/bubble-trouble-<version>.zip`.
Anyone can drag it into Extension Manager.

## Notes

- The sidebar is SketchUp's own docked inspector column, so `width` and
  position are set by SketchUp, not by the manifest. Only `height` applies.
- A zip ignores `baseUrl`, and a bare `.json` honors it. That's why there are
  two manifests, and why the dev one is generated instead of hand-maintained.
