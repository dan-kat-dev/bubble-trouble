# Questions for the SketchUp JS API team

1. **TypeScript package:** when will `@sketchup/sketchup-js-api` (the typed SDK
   used in the TypeScript tutorial) be available to outside developers on npm?
   For now we keep a hand-written type file.
2. **Counting geometry cheaply:** is there a way to count faces and edges per
   definition without fetching every face and edge snapshot? Something like
   `getNumberOfFaces()`, but per definition.
3. **Selecting nested entities:** what's the recommended way to select an
   instance nested several levels deep? Is it `modelSetActivePath` followed by
   `updateSelection`? Does opening the active path add an undo step, and can it
   be avoided (for example with `transparent: true`)?
4. **Granular change events:** is there an observer that reports which
   entities were added, removed or changed, instead of only a new model
   revision? Re-reading the whole model on every edit won't scale.
5. **Stable ids:** do entity ids stay the same across undo and redo, and what
   happens to the ids of a group's contents when the group is exploded?
6. **Sidebar width:** can a `sidebar` extension ask for a wider panel, or let
   the user resize it?
7. **Dev server:** is running a Vite dev server with hot reload inside the
   extension iframe supported? Anything to watch out for, like a CSP or
   websocket limits?
8. **Desktop:** is the JS API coming to SketchUp desktop, and roughly when?
   It decides whether the desktop version needs a Ruby bridge at all.
