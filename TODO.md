# TODO

- [ ] Use TS not JS everywhere I can (planned in PLAN.md)
- [ ] Swap the hand-written `src/sketchup/sketchup-api.d.ts` for the official `@sketchup/sketchup-js-api` package once it's on npm (see QUESTIONS.md #1)
- [ ] Check if you can change the width of a sidebar type panel as a SU extension (see QUESTIONS.md #6)
- [ ] Match SketchUp CSS using the CSS example extension they have (planned in PLAN.md)
- [ ] Ruby desktop version: reuse the app inside an `HtmlDialog` and add a `ModelSource` that talks to Ruby over `postMessage`. All SketchUp calls already go through `src/sketchup/`.
- [ ] Make the Ruby version as KISS and DRY as possible
- [ ] Fuzzy-matching search (Levenshtein distance)
- [ ] AI-powered search
- [ ] Different outlines (or some other visual difference) for groups vs components
- [ ] Better colors
- [ ] Hover tooltips with full names
- [ ] When something is selected, zoom in on that group
- [ ] Size option that uses faces AND edges totals together
