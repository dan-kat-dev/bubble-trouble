import { JsaSource } from './jsa-source';
import { MockSource } from './mock-source';
import { RubySource } from './ruby-source';
import type { ModelSource } from './source';

/**
 * SketchUp desktop (Ruby) when opened from the desktop extension, SketchUp Web
 * when running inside it, otherwise the mock house.
 * Add ?mock to the URL to force the mock, or ?mock=50 for a street of 50 houses.
 */
export function createSource(): ModelSource {
  const mock = new URLSearchParams(location.search).get('mock');
  if (mock !== null) return new MockSource(Number(mock) || 1);

  const ruby = globalThis.sketchup;
  if (ruby && typeof ruby.getSnapshot === 'function') return new RubySource(ruby);

  const api = globalThis.SketchUpApi;
  let inSketchUp = false;
  try {
    inSketchUp = !!api && api.isInSketchUp();
  } catch {
    inSketchUp = false;
  }
  return api && inSketchUp ? new JsaSource(api) : new MockSource();
}
