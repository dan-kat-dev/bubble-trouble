/**
 * The outline: the model's groups and components as a tree, with face and
 * edge counts. Every view draws from this one shape.
 *
 * Model sources (SketchUp, mock) don't build the tree themselves. They report a
 * ModelSnapshot: each definition's own geometry counts and child instances.
 * buildTree() turns that into the tree, so both sources share the same logic.
 */

export type NodeKind = 'model' | 'group' | 'component';
export type SizeMetric = 'faces' | 'edges';

export interface OutlineNode {
  /**
   * Unique and stable across reloads: the entity ids from the root down, like
   * "12/40/41". A nested instance appears once per copy of its parent, and the
   * key tells those copies apart. Views use it to match old shapes to new ones.
   */
  key: string;
  /** The SketchUp entity id of the instance (or -1 for the model itself). */
  entityId: number;
  /** Entity ids from the root down, ending with this node. Empty for the model. */
  path: number[];
  name: string;
  kind: NodeKind;
  definitionId: number | null;
  definitionName: string;
  depth: number;
  /** Geometry directly inside this node's definition. */
  ownFaces: number;
  ownEdges: number;
  /** Totals including everything nested inside. */
  faces: number;
  edges: number;
  children: OutlineNode[];
}

/** One group or component instance inside a definition. */
export interface ChildRef {
  entityId: number;
  /** The instance's own name; often empty. */
  name: string;
  definitionId: number;
  kind: 'group' | 'component';
}

/** A definition's own contents (not including what its children contain). */
export interface DefinitionInfo {
  id: number;
  name: string;
  faces: number;
  edges: number;
  children: ChildRef[];
}

export interface ModelSnapshot {
  title: string;
  /** The model's top-level entities, shaped like a definition. */
  root: DefinitionInfo;
  definitions: Map<number, DefinitionInfo>;
}

/** Deeper than this is almost certainly a bug (SketchUp forbids cycles). */
const MAX_DEPTH = 64;

export function buildTree(snapshot: ModelSnapshot): OutlineNode {
  const root: OutlineNode = {
    key: 'root',
    entityId: -1,
    path: [],
    name: snapshot.title || 'Untitled model',
    kind: 'model',
    definitionId: null,
    definitionName: '',
    depth: 0,
    ownFaces: snapshot.root.faces,
    ownEdges: snapshot.root.edges,
    faces: 0,
    edges: 0,
    children: [],
  };
  root.children = buildChildren(snapshot, snapshot.root, root);
  sumTotals(root);
  return root;
}

function buildChildren(
  snapshot: ModelSnapshot,
  definition: DefinitionInfo,
  parent: OutlineNode
): OutlineNode[] {
  if (parent.depth >= MAX_DEPTH) return [];

  return definition.children.map((child) => {
    const childDefinition = snapshot.definitions.get(child.definitionId);
    const path = [...parent.path, child.entityId];
    const node: OutlineNode = {
      key: path.join('/'),
      entityId: child.entityId,
      path,
      name: child.name || (child.kind === 'group' ? 'Group' : childDefinition?.name ?? 'Component'),
      kind: child.kind,
      definitionId: child.definitionId,
      definitionName: childDefinition?.name ?? '',
      depth: parent.depth + 1,
      ownFaces: childDefinition?.faces ?? 0,
      ownEdges: childDefinition?.edges ?? 0,
      faces: 0,
      edges: 0,
      children: [],
    };
    if (childDefinition) node.children = buildChildren(snapshot, childDefinition, node);
    return node;
  });
}

function sumTotals(node: OutlineNode): void {
  node.faces = node.ownFaces;
  node.edges = node.ownEdges;
  for (const child of node.children) {
    sumTotals(child);
    node.faces += child.faces;
    node.edges += child.edges;
  }
}

/** Every node below the root, depth first. */
export function descendants(root: OutlineNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  const visit = (node: OutlineNode) => {
    for (const child of node.children) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** Index nodes by key, for looking up parents and previous positions. */
export function indexByKey(root: OutlineNode): Map<string, OutlineNode> {
  const map = new Map<string, OutlineNode>([[root.key, root]]);
  for (const node of descendants(root)) map.set(node.key, node);
  return map;
}

/** The key of a node's parent ("12/40/41" → "12/40"; top level → "root"). */
export function parentKey(key: string): string | null {
  if (key === 'root') return null;
  const i = key.lastIndexOf('/');
  return i === -1 ? 'root' : key.slice(0, i);
}
