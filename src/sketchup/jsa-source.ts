/**
 * JsaSource: reads and selects in SketchUp Web through the SketchUp JS API.
 *
 * This is the only file that calls SketchUpApi. Everything else goes through
 * the ModelSource interface, so a desktop (Ruby) version can swap this out.
 *
 *   1. Connect
 *   2. Read the model into a snapshot, then a tree
 *   3. Watch for model and selection changes
 *   4. Select, including nested instances
 */

import { buildTree, type ChildRef, type DefinitionInfo, type OutlineNode } from '../model/outline';
import type { ModelSource } from './source';

/** The entity types we read. Faces and edges are only counted. */
const QUERY: SU.EntityQuery = { filterBy: { types: ['Face', 'Edge', 'Group', 'ComponentInstance'] } };
const INSTANCES: SU.EntityQuery = { filterBy: { types: ['Group', 'ComponentInstance'] } };

export class JsaSource implements ModelSource {
  readonly kind = 'sketchup';

  private api: SU.Sketchup;
  private model: SU.Model | null = null;
  /** Instance snapshots by entity id, from the last load. Used for selecting. */
  private instances = new Map<number, SU.Group | SU.ComponentInstance>();

  constructor(api: SU.Sketchup) {
    this.api = api;
  }

  // -------------------------------------------------------------------------
  // 1. Connect
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    // Queue our operations behind the user's instead of failing.
    await this.api.connect({ whenOperationInProgress: 'queue' });
    this.model = await this.api.getActiveModel();
  }

  // -------------------------------------------------------------------------
  // 2. Read the model
  // -------------------------------------------------------------------------

  /**
   * Each definition is read once, however many instances it has: its own
   * face and edge counts plus its child instances. buildTree() does the rest.
   *
   * Counting faces this way fetches every face snapshot, which will get slow
   * on big models (QUESTIONS.md #2).
   */
  async load(): Promise<OutlineNode> {
    const model = await this.api.getActiveModel();
    this.model = model;
    this.instances.clear();

    const definitions = (await model.getDefinitions()).filter((d) => !d.isImage);
    const infos = await Promise.all(definitions.map((d) => this.readContainer(d.id, d.name, d.entities)));
    const root = await this.readContainer(-1, model.title, model.entities);

    return buildTree({
      title: model.title,
      root,
      definitions: new Map(infos.map((info) => [info.id, info])),
    });
  }

  private async readContainer(id: number, name: string, entities: SU.Entities): Promise<DefinitionInfo> {
    const { Face, Edge, Group, ComponentInstance } = this.api.EntityType;
    const elements = await entities.get(QUERY);
    const info: DefinitionInfo = { id, name, faces: 0, edges: 0, children: [] };

    for (const element of elements) {
      if (element.type === Face) info.faces++;
      else if (element.type === Edge) info.edges++;
      else if (element.type === Group || element.type === ComponentInstance) {
        const instance = element as SU.Group | SU.ComponentInstance;
        this.instances.set(instance.id, instance);
        const child: ChildRef = {
          entityId: instance.id,
          name: instance.name ?? '',
          definitionId: instance.definitionId,
          kind: element.type === Group ? 'group' : 'component',
        };
        info.children.push(child);
      }
    }
    return info;
  }

  // -------------------------------------------------------------------------
  // 3. Watch for changes
  // -------------------------------------------------------------------------

  /** Fires when the revision changes (commit, undo, redo) or another model opens. */
  onModelChanged(callback: () => void): () => void {
    let previous: SU.ModelRevision | null = null;
    const handle = this.api.observeActiveModel((revision) => {
      if (previous && revision.isModelChanged(previous)) callback();
      previous = revision;
    });
    return () => handle.stop();
  }

  onSelectionChanged(callback: (entityIds: Set<number>) => void): () => void {
    const model = this.requireModel();
    const handle = model.observeSelectionMetadata(async () => {
      const selection = await model.getSelection(INSTANCES);
      callback(new Set(selection.drawingElements.map((e) => e.id)));
    }, INSTANCES);
    return () => handle.stop();
  }

  // -------------------------------------------------------------------------
  // 4. Select
  // -------------------------------------------------------------------------

  /**
   * Top-level instances are selected directly. Nested ones need their parents
   * opened first (the active path), which is what double-clicking does by hand.
   *
   * Not verified in SketchUp yet: whether opening the path adds an undo step
   * (QUESTIONS.md #3).
   */
  async select(node: OutlineNode | null): Promise<void> {
    const model = this.requireModel();
    if (!node || node.kind === 'model') {
      await model.updateSelection([], 'replace');
      return;
    }

    const target = this.instances.get(node.entityId);
    if (!target) return;
    const ancestors = node.path
      .slice(0, -1)
      .map((id) => this.instances.get(id))
      .filter((e): e is SU.Group | SU.ComponentInstance => e !== undefined);

    if (ancestors.length > 0) {
      await model.performOperation((op) => op.modelSetActivePath(ancestors), 'Bubble Trouble: open path');
    }
    try {
      await model.updateSelection(target, 'replace');
    } catch {
      // The user may be inside another group: go back to the top level and retry.
      await model.performOperation((op) => op.modelSetActivePath([]), 'Bubble Trouble: open path');
      await model.updateSelection(target, 'replace');
    }
  }

  private requireModel(): SU.Model {
    if (!this.model) throw new Error('Not connected to SketchUp yet.');
    return this.model;
  }
}
