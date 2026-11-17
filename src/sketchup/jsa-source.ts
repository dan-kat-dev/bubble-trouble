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
 *   5. Zoom the camera
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

  onActivePathChanged(callback: (path: number[]) => void): () => void {
    const handle = this.requireModel().observeActivePath((activePath) => callback(activePath.path.map((e) => e.id)));
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
      if ((await model.getActivePath()).path.length > 0) {
        await model.performOperation((op) => op.modelSetActivePath([]), 'Bubble Trouble: close path');
      }
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

  /** Open the node itself (not just its parents), with nothing selected inside. */
  async open(node: OutlineNode): Promise<void> {
    const model = this.requireModel();
    const path = node.path.map((id) => this.instances.get(id));
    if (path.some((e) => e === undefined)) return;
    await model.updateSelection([], 'replace');
    await model.performOperation((op) => op.modelSetActivePath(path as SU.ActivePathEntity[]), 'Bubble Trouble: open');
  }

  // -------------------------------------------------------------------------
  // 5. Zoom the camera
  // -------------------------------------------------------------------------

  /**
   * The JS API has no "zoom to selection" or "zoom extents", so: take the
   * bounds, keep the camera's direction, and back the eye off until a sphere
   * around them fits the field of view.
   *
   * Not verified in SketchUp yet: we assume bounds are in the open group's
   * coordinates, so they're moved to world coordinates with the active path's
   * transform (QUESTIONS.md #9).
   */
  async zoomToSelection(): Promise<void> {
    const model = this.requireModel();
    const selection = await model.getSelection(INSTANCES);
    const ids = selection.drawingElements.map((e) => e.sketchupId);
    if (ids.length === 0) return;

    const [boxes, activePath] = await Promise.all([model.getEntitiesBoundsByIds(ids), model.getActivePath()]);
    await this.frame(boxes.flatMap(corners).map((p) => activePath.transform.applyTo(p)));
  }

  async zoomExtents(): Promise<void> {
    const bounds = await this.requireModel().getBounds();
    await this.frame(corners(bounds));
  }

  /** Point the camera, keeping its direction, so all these world points fit in view. */
  private async frame(points: (SU.Point3d | [number, number, number])[]): Promise<void> {
    const model = this.requireModel();
    const camera = await model.view.getCamera();
    const xyzOf = (p: SU.Point3d | [number, number, number]) => (Array.isArray(p) ? p : xyz(p));
    const min = [0, 1, 2].map((i) => Math.min(...points.map((p) => xyzOf(p)[i])));
    const max = [0, 1, 2].map((i) => Math.max(...points.map((p) => xyzOf(p)[i])));
    const center = min.map((v, i) => (v + max[i]) / 2);
    const radius = Math.max(1, Math.hypot(...max.map((v, i) => v - min[i])) / 2) * 1.1;

    const direction = xyz(camera.direction);
    const length = Math.hypot(...direction) || 1;
    const halfFov = ((camera.fieldOfView || 35) * Math.PI) / 360;
    const distance = radius / Math.sin(halfFov);
    const eye = center.map((v, i) => v - (direction[i] / length) * distance);

    let next = camera.withOrientation(eye as [number, number, number], center as [number, number, number], camera.up);
    if (camera.data.type !== 'perspective') next = next.withHeight(radius * 2);
    await model.view.setCamera(next, 0.4);
  }

  private requireModel(): SU.Model {
    if (!this.model) throw new Error('Not connected to SketchUp yet.');
    return this.model;
  }
}

const xyz = (p: SU.Point3d | SU.Vector3d): [number, number, number] => [p.x, p.y, p.z];

/** A box's 8 corners, so a rotated parent transform still covers it. */
function corners(box: SU.BoundingBox): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push([x, y, z]);
  return out;
}
