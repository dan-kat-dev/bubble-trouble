/**
 * MockSource: a fake house model, used when the app runs outside SketchUp.
 *
 * It has the same shape a real model has (shared component definitions,
 * nested groups) and can fake deletes, explodes and additions, so the views
 * and their animations can be built and tested in a normal browser.
 */

import { buildTree, descendants, type ChildRef, type DefinitionInfo, type OutlineNode } from '../model/outline';
import type { ModelSource } from './source';

export class MockSource implements ModelSource {
  readonly kind = 'mock';

  private nextId = 1;
  private definitions = new Map<number, DefinitionInfo>();
  private componentsByName = new Map<string, DefinitionInfo>();
  private root: DefinitionInfo;
  private modelListeners = new Set<() => void>();
  private selectionListeners = new Set<(ids: Set<number>) => void>();
  private activePathListeners = new Set<(path: number[]) => void>();

  constructor() {
    this.root = { id: -1, name: 'Model', faces: 0, edges: 0, children: [] };
    this.buildHouse();
  }

  async connect(): Promise<void> {}

  async load(): Promise<OutlineNode> {
    return buildTree({ title: 'Mock house', root: this.root, definitions: this.definitions });
  }

  onModelChanged(callback: () => void): () => void {
    this.modelListeners.add(callback);
    return () => this.modelListeners.delete(callback);
  }

  /** Like SketchUp: selecting a nested node opens its parents. */
  async select(node: OutlineNode | null): Promise<void> {
    const ids = new Set(node ? [node.entityId] : []);
    setTimeout(() => {
      this.setActivePath(node ? node.path.slice(0, -1) : []);
      this.selectionListeners.forEach((cb) => cb(ids));
    }, 30);
  }

  async open(node: OutlineNode): Promise<void> {
    setTimeout(() => {
      this.setActivePath(node.path);
      this.selectionListeners.forEach((cb) => cb(new Set()));
    }, 30);
  }

  onActivePathChanged(callback: (path: number[]) => void): () => void {
    this.activePathListeners.add(callback);
    return () => this.activePathListeners.delete(callback);
  }

  onSelectionChanged(callback: (ids: Set<number>) => void): () => void {
    this.selectionListeners.add(callback);
    return () => this.selectionListeners.delete(callback);
  }

  /** No camera to move. */
  async zoomToSelection(): Promise<void> {}

  // -------------------------------------------------------------------------
  // Fake edits, for testing the animations
  // -------------------------------------------------------------------------

  /** Open a random group or component for editing, like double-clicking it. */
  async openRandom(): Promise<void> {
    const node = pick(descendants(await this.load()).filter((n) => n.children.length > 0));
    if (node) this.setActivePath(node.path);
  }

  private setActivePath(path: number[]): void {
    this.activePathListeners.forEach((cb) => cb(path));
  }

  /** Erase a random instance. */
  deleteRandom(): void {
    const container = pick(this.containers().filter((d) => d.children.length > 0));
    if (!container) return;
    container.children.splice(Math.floor(Math.random() * container.children.length), 1);
    this.changed();
  }

  /** Explode a random group: its contents move up into its parent with new ids. */
  explodeRandom(): void {
    const candidates = this.containers().flatMap((parent) =>
      parent.children.filter((c) => c.kind === 'group').map((child) => ({ parent, child }))
    );
    const target = pick(candidates);
    if (!target) return;
    const { parent, child } = target;
    const group = this.definitions.get(child.definitionId)!;
    const moved = group.children.map((c) => ({ ...c, entityId: this.nextId++ }));
    parent.children.splice(parent.children.indexOf(child), 1, ...moved);
    parent.faces += group.faces;
    parent.edges += group.edges;
    this.changed();
  }

  /** Add an instance of a random component to a random container. */
  addRandom(): void {
    const container = pick(this.containers());
    const definition = pick([...this.componentsByName.values()]);
    if (!container || !definition) return;
    container.children.push(this.instance(definition.name));
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Building the house
  // -------------------------------------------------------------------------

  private buildHouse(): void {
    this.component('Leg', 60);
    this.component('Chair', 380, [...this.instances('Leg', 4)]);
    this.component('Cabinet', 340);
    this.component('Fridge', 1800);
    this.component('Sink', 950);
    this.component('Sofa', 2400);
    this.component('Lamp', 1100);
    this.component('Plant', 5200);
    this.component('Book', 60);
    this.component('Vase', 700);
    this.component('Tree', 3000);
    this.component('Car', 8000);
    this.component('Post', 24);

    this.root.children = [
      this.group('Walls', 420),
      this.group('Roof', 180),
      this.group('Kitchen', 0, [
        ...this.instances('Cabinet', 6),
        this.instance('Fridge'),
        this.instance('Sink'),
        ...this.instances('Chair', 4),
      ]),
      this.group('Living room', 0, [
        this.instance('Sofa'),
        ...this.instances('Chair', 2),
        this.instance('Lamp'),
        this.instance('Plant'),
        this.group('Shelf', 30, [...this.instances('Book', 8), this.instance('Vase')]),
      ]),
      this.group('Site', 0, [
        ...this.instances('Tree', 5),
        this.instance('Car'),
        this.group('Fence', 0, [...this.instances('Post', 10)]),
      ]),
    ];
  }

  private component(name: string, faces: number, children: ChildRef[] = []): void {
    const definition = this.definition(name, faces, children);
    this.componentsByName.set(name, definition);
  }

  /** Every group gets its own definition, like in SketchUp. */
  private group(name: string, faces: number, children: ChildRef[] = []): ChildRef {
    const definition = this.definition(`Group#${this.nextId}`, faces, children);
    return { entityId: this.nextId++, name, definitionId: definition.id, kind: 'group' };
  }

  private definition(name: string, faces: number, children: ChildRef[]): DefinitionInfo {
    const definition = { id: this.nextId++, name, faces, edges: Math.round(faces * 1.6), children };
    this.definitions.set(definition.id, definition);
    return definition;
  }

  private instance(definitionName: string): ChildRef {
    const definition = this.componentsByName.get(definitionName)!;
    return { entityId: this.nextId++, name: '', definitionId: definition.id, kind: 'component' };
  }

  private instances(definitionName: string, count: number): ChildRef[] {
    return Array.from({ length: count }, () => this.instance(definitionName));
  }

  /** The model root plus every group definition: places the fake edits can touch. */
  private containers(): DefinitionInfo[] {
    const groups = [...this.definitions.values()].filter((d) => d.name.startsWith('Group#'));
    return [this.root, ...groups];
  }

  private changed(): void {
    this.modelListeners.forEach((cb) => cb());
  }
}

function pick<T>(items: T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}
