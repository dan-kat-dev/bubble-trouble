# Bubble Trouble: implementation plan

A visual outliner for SketchUp Web. The goal of this first pass is a working
prototype you can install in SketchUp: read the model's groups and components,
draw them in three switchable views, and stay in sync with the model.

## Goals for the prototype

1. **Three views of the same data**, switchable from a toolbar:
   - **Free bubbles**: one bubble per group or component instance, not nested.
     Bubbles push apart with real physics and cluster by a chosen property
     (top-level parent, definition, or type). Good for sorting and comparing.
   - **Nested bubbles**: circle packing. Bubbles inside bubbles show nesting.
   - **Treemap**: nested rectangles. Same data, no wasted space.
2. **Size by** face count or edge count.
3. **Hover** a bubble: every instance of the same definition lights up.
4. **Click** a bubble: select it in SketchUp, including nested ones, without
   double-clicking into each group.
5. **Selection sync**: selecting in SketchUp highlights the bubble.
6. **Live updates**: delete, explode or add something in SketchUp and the view
   animates to the new layout (bubbles pop out, grow in, glide to new spots).
7. **Search** by name: matches stay bright, everything else dims.
8. **Looks native**: uses SketchUp's shared extension stylesheet and its
   `--su-*` colors, so it follows light and dark mode like SketchUp's own panels.
9. **Runs without SketchUp** too: opened in a normal browser it uses a fake
   model, with buttons to fake deletes and explodes, so the views can be built
   and tested quickly.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Build and dev server | **Vite** | Fast, handles TypeScript and Vue, hot reload while developing |
| UI | **Vue 3**, Options API (`<script lang="ts">` + `defineComponent`), no composables | Toolbar, search, mode switcher; renders the SVG shapes directly |
| Language | **TypeScript everywhere** | App code, Vue components, Vite config and the Node scripts (Node 24 runs `.ts` directly) |
| Layout math | **`d3-hierarchy`** (`pack`, `treemap`) | Only the math: give it a nested object, get back x, y and sizes. No D3 DOM code. |
| Physics (free bubbles) | **`d3-force`** | Collision and clustering. Also math only; Vue draws the circles. |
| Animation (nested and treemap) | Small spring animator of our own | Each shape springs from its old position and size to its new one. Feels physical, stays predictable. |
| Styling | SketchUp's shared `sketchup-extension.css` from their CDN | Native look, dark mode, `--su-*` color variables |
| Zip | `archiver` | Packs the built extension |

**Keep it simple.** Plain classes and functions for logic, Options API
components for UI, no extra state libraries.

**No D3 DOM code.** D3's confusing part is selecting and updating page elements
(`d3.select(...).data(...).join(...)`). We skip that entirely: D3 only computes
numbers, and Vue templates draw `<circle>` and `<rect>` elements from them.

### TypeScript and the SketchUp API

SketchUp's TypeScript tutorial uses an npm package, `@sketchup/sketchup-js-api`,
that isn't published yet (npm returns 404, and their docs say it isn't available
to outside developers). For now we keep **our own type file**,
`src/sketchup/sketchup-api.d.ts`, covering only the calls this extension makes,
written from the official API reference. When the package ships, delete that
file and install the package. Nothing else should need to change, because all
SketchUp calls go through one file (see "Model bridge").

## Answer: can nested bubbles have physics?

Full physics on nested bubbles (every circle colliding inside its parent, at
every level, at once) is hard to make stable, and it's not what makes it feel
good. The approach:

1. Compute the target layout with `d3-hierarchy`'s `pack` (or `treemap`).
2. Every shape is matched to its previous version by a stable key.
3. A spring animator moves each shape from where it is to where it should be,
   with a little overshoot. New shapes grow out of their parent; removed ones
   pop and fade.

That gives the "everything rearranges itself" feel when you delete or explode
something, and the layout always ends up tidy. Free bubbles use real physics
(`d3-force`), because there's no nesting to keep tidy there.

## Architecture

```
index.html                 thin shell: SketchUp CSS, SketchUp SDK, then src/main.ts
public/
  manifest.json            release manifest (baseUrl "/"), copied into the build
  bubble-trouble.svg       icon
src/
  main.ts                  mounts the Vue app
  App.vue                  toolbar (mode, size-by, cluster-by, search) + current view
  styles.css               our styles on top of SketchUp's stylesheet
  sketchup/
    sketchup-api.d.ts      hand-written types for the SketchUp calls we use
    source.ts              ModelSource interface: the only way the app talks to a model
    jsa-source.ts          SketchUp Web implementation (the only file that calls SketchUpApi)
    mock-source.ts         fake model for running in a normal browser
  model/
    outline.ts             OutlineNode type and helpers
  viz/
    spring.ts              spring animator used by the nested and treemap views
    colors.ts              colors by top-level branch
    FreeBubbles.vue
    NestedBubbles.vue
    Treemap.vue
scripts/
  certs.ts                 npm run certs: mkcert HTTPS certificate for localhost
  dev-manifest.ts          writes dist/bubble-trouble-localhost.json
  zip.ts                   npm run zip: validates and zips the build
vite.config.ts             HTTPS on port 9000, CORS, relative paths for the zip
```

### Model bridge

The app never calls `SketchUpApi` directly. It talks to a `ModelSource`:

```ts
interface ModelSource {
  load(): Promise<OutlineNode>                         // the whole tree
  onModelChanged(cb: () => void): () => void           // fires after edits, undo, redo
  select(node: OutlineNode): Promise<void>             // select in SketchUp
  onSelectionChanged(cb: (entityIds: Set<number>) => void): () => void
}
```

There are two implementations: `jsa-source.ts` for SketchUp Web, and
`mock-source.ts` for the browser. A future **Ruby desktop** version adds a
third, which sends the same requests to Ruby over `postMessage` from inside an
`HtmlDialog`. The views and UI stay unchanged.

### Reading the model

1. `model.getDefinitions()` lists every component definition, and group
   definitions too.
2. For each definition, `definition.entities.get(...)` with a type filter
   (`Face`, `Edge`, `Group`, `ComponentInstance`) gives its own face and edge
   counts and its child instances. Each definition is read once, however many
   instances it has.
3. The root is `model.entities.get(...)` with the same filter.
4. The tree is built from the root down by following each instance to its
   definition. Totals (faces and edges, including everything nested) are summed
   on the way back up.

Each node gets a **key** made of the entity ids along its path from the root
(`"12/40/41"`). The same nested instance appears once per copy of its parent,
and the key keeps those copies apart. Keys are also what the animations use to
match old shapes to new ones.

### Live updates

`SketchUpApi.observeActiveModel` fires when the model's revision changes
(edits, undo, redo). We re-read the model, debounced, and hand the new tree to
the views, which animate the difference. Selection uses
`model.observeSelectionMetadata`, then `model.getSelection()`.

### Selecting nested things

Top-level: `model.updateSelection(entity, 'replace')`. Nested: open the parent
path with `op.modelSetActivePath([...ancestors])`, then select. Not verified
yet: whether opening the path adds an undo step (see QUESTIONS.md).

## Dev and release workflow

- `npm run dev`: Vite serves the app at `https://localhost:9000/` with hot
  reload, and writes `dist/bubble-trouble-localhost.json`. Install that bare
  `.json` in Extension Manager once. Saving a file then updates the panel. Hot
  reload is not tested inside SketchUp yet.
  Without certificates it falls back to plain HTTP with a warning. That's fine
  for testing in a normal browser with the fake model, but SketchUp won't load it.
- `npm run build`: builds the extension into `dist/extension/`.
- `npm run zip`: builds, validates and writes `dist/bubble-trouble-<version>.zip`.

## Milestones (one commit each)

1. This plan, `QUESTIONS.md`, TODO updates.
2. Vite, Vue and TypeScript scaffold. Scripts move to TypeScript. HTTPS dev
   server, dev manifest, zip from the build. SketchUp stylesheet in place.
3. SketchUp types, model bridge (SketchUp and mock), tree builder.
4. Views: free bubbles, nested bubbles, treemap, and the mode switcher.
5. Interaction: hover highlight, click to select, selection sync, live updates,
   search, and mock edit buttons.
6. README refresh and verification.

## Later

- Icicle view as a fourth mode (fits the narrow sidebar well).
- Zoom into a bubble and breadcrumbs.
- Canvas rendering if big models get slow in SVG.
- More "size by" and "color by" options: tag, material, definition.
- Ruby desktop version (see TODO.md).
- Sibling tools for other panels (Tags, Materials).
