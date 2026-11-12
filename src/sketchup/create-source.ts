import { JsaSource } from './jsa-source';
import { MockSource } from './mock-source';
import type { ModelSource } from './source';

/**
 * SketchUp when we're running inside it, otherwise the mock house.
 * Add ?mock to the URL to force the mock.
 */
export function createSource(): ModelSource {
  const forceMock = new URLSearchParams(location.search).has('mock');
  const api = globalThis.SketchUpApi;
  let inSketchUp = false;
  try {
    inSketchUp = !!api && api.isInSketchUp();
  } catch {
    inSketchUp = false;
  }
  return api && inSketchUp && !forceMock ? new JsaSource(api) : new MockSource();
}
