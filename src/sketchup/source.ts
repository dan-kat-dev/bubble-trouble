/**
 * ModelSource: the only way the app talks to a model.
 *
 * Implementations:
 *   - JsaSource:  SketchUp Web, through the SketchUp JS API.
 *   - MockSource: a fake model, for running in a normal browser.
 * A future Ruby desktop version adds one that talks to Ruby over postMessage
 * (see TODO.md). The views never know which one they're using.
 */

import type { OutlineNode } from '../model/outline';

export interface ModelSource {
  readonly kind: 'sketchup' | 'mock';
  connect(): Promise<void>;
  /** Read the whole model into an outline tree. */
  load(): Promise<OutlineNode>;
  /** Called after edits, undo, redo or a model switch. Returns an unsubscribe. */
  onModelChanged(callback: () => void): () => void;
  /** Select this node in the model, or clear the selection with null. */
  select(node: OutlineNode | null): Promise<void>;
  /** Called with the entity ids of selected groups and components. Returns an unsubscribe. */
  onSelectionChanged(callback: (entityIds: Set<number>) => void): () => void;
}
