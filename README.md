# Bubble Trouble

A visual outliner for SketchUp: see, search and select everything in your model
at a glance, without double-clicking ten levels deep.

Three views of the same data, switchable from the toolbar:

- **Free**: one bubble per group or component, with physics. Cluster by
  top-level parent, definition or type.
- **Nested**: bubbles inside bubbles (circle packing).
- **Treemap**: nested rectangles.

Hover a bubble to light up every copy of the same component. Click to select it
in SketchUp. Edits in SketchUp animate into the view.

Built with Vue 3 (Options API), Vite and TypeScript on the
[SketchUp JavaScript API](https://developer.trimble.com/docs/sketchup/jsa/welcome/)
(SketchUp Web, JSA Labs). See [PLAN.md](PLAN.md) for how it's put together,
[TODO.md](TODO.md) for what's next, and [QUESTIONS.md](QUESTIONS.md) for open
questions for the SketchUp team.

## Layout

```
index.html               thin shell: SketchUp CSS, SketchUp SDK, then src/main.ts
public/                  manifest.json and the icon, copied into the build as-is
src/
  App.vue                toolbar + the current view
  model/outline.ts       the outline tree every view draws from
  sketchup/              everything that talks to a model
    jsa-source.ts        SketchUp Web (the only file that calls SketchUpApi)
    mock-source.ts       fake model for running in a normal browser
    sketchup-api.d.ts    hand-written SketchUp API types (until their npm package ships)
  viz/                   FreeBubbles, NestedBubbles, Treemap + shared helpers
scripts/                 certs, dev manifest and zip (TypeScript, run by Node directly)
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

## Develop

```bash
npm run dev
```

This serves the app at `https://localhost:9000/` with hot reload, and writes
`dist/bubble-trouble-localhost.json`.

**In SketchUp:**

1. Open [SketchUp Web JSA Labs](https://jsa-labs.sketchup.com) and a model.
2. **Extensions > Extension Manager**, then drag in
   `dist/bubble-trouble-localhost.json` (the bare `.json`, not zipped). You
   only do this once.
3. **Extensions > Bubble Trouble DEV** opens the sidebar panel.
4. Edit code and save. The panel should hot-reload. If it doesn't, close and
   reopen it.

You only need to reinstall the dev manifest when `public/manifest.json` changes.

**In a normal browser:** open `https://localhost:9000/`. Outside SketchUp it
uses a fake house model, with buttons to fake deletes, explodes and additions.
Add `?mock` to force the fake model.

## Share (zip)

```bash
npm run zip
```

Builds into `dist/extension/` and writes `dist/bubble-trouble-<version>.zip`.
Anyone can drag it into Extension Manager. Bump `version` in
`public/manifest.json` (not `manifestFormatVersion`) for each release.

## Other scripts

- `npm run typecheck`: type-check everything.
- `npm run build`: type-check and build without zipping.

## Notes

- The sidebar is SketchUp's own docked inspector column, so `width` and
  position are set by SketchUp, not by the manifest. Only `height` applies.
- A zip ignores `baseUrl`, and a bare `.json` honors it. That's why there are
  two manifests, and why the dev one is generated instead of hand-maintained.
