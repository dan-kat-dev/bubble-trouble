/**
 * RubySource: the desktop stand-in for the JS API.
 *
 * SketchUp desktop doesn't have the JS API yet, so the Ruby half of the
 * extension (ruby/bubble_trouble/main.rb) opens this same app in an HtmlDialog
 * and answers its requests:
 *
 *   JS → Ruby: sketchup.getSnapshot(), sketchup.select(path)
 *              (the `sketchup` object is injected by HtmlDialog)
 *   Ruby → JS: bubbleTrouble.snapshot(data), .modelChanged(), .selectionChanged(ids)
 *
 * Ruby sends the same snapshot shape the other sources build, so the tree and
 * the views don't change. When desktop gets the JS API, delete this file and
 * ruby/.
 */

import { buildTree, type DefinitionInfo, type OutlineNode } from '../model/outline';
import type { ModelSource } from './source';

/** Callbacks registered in Ruby with dialog.add_action_callback. */
export interface RubyBridge {
  getSnapshot(): void;
  select(path: number[]): void;
}

interface RubySnapshot {
  title: string;
  root: DefinitionInfo;
  definitions: DefinitionInfo[];
}

declare global {
  /** Injected by SketchUp's HtmlDialog. Missing everywhere else. */
  var sketchup: RubyBridge | undefined;
  /** Ruby calls these with dialog.execute_script. */
  var bubbleTrouble:
    | {
        snapshot(data: RubySnapshot): void;
        modelChanged(): void;
        selectionChanged(entityIds: number[]): void;
      }
    | undefined;
}

export class RubySource implements ModelSource {
  readonly kind = 'desktop';

  private ruby: RubyBridge;
  private pendingLoads: ((tree: OutlineNode) => void)[] = [];
  private modelListeners = new Set<() => void>();
  private selectionListeners = new Set<(ids: Set<number>) => void>();

  constructor(ruby: RubyBridge) {
    this.ruby = ruby;
    globalThis.bubbleTrouble = {
      snapshot: (data) => {
        const tree = buildTree({
          title: data.title,
          root: data.root,
          definitions: new Map(data.definitions.map((d) => [d.id, d])),
        });
        this.pendingLoads.splice(0).forEach((resolve) => resolve(tree));
      },
      modelChanged: () => this.modelListeners.forEach((cb) => cb()),
      selectionChanged: (entityIds) => {
        const ids = new Set(entityIds);
        this.selectionListeners.forEach((cb) => cb(ids));
      },
    };
  }

  async connect(): Promise<void> {}

  /** Ask Ruby for a snapshot; it answers by calling bubbleTrouble.snapshot(). */
  load(): Promise<OutlineNode> {
    return new Promise((resolve) => {
      this.pendingLoads.push(resolve);
      this.ruby.getSnapshot();
    });
  }

  onModelChanged(callback: () => void): () => void {
    this.modelListeners.add(callback);
    return () => this.modelListeners.delete(callback);
  }

  async select(node: OutlineNode | null): Promise<void> {
    this.ruby.select(node ? node.path : []);
  }

  onSelectionChanged(callback: (ids: Set<number>) => void): () => void {
    this.selectionListeners.add(callback);
    return () => this.selectionListeners.delete(callback);
  }
}
