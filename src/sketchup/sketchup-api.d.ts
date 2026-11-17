/**
 * Hand-written types for the parts of the SketchUp JS API this extension uses.
 *
 * Written from the official API reference:
 *   https://developer.trimble.com/docs/sketchup/jsa/api/overview/
 *
 * Temporary. SketchUp's typed SDK, @sketchup/sketchup-js-api, isn't on npm yet
 * (see QUESTIONS.md #1). When it is, delete this file, install the package,
 * and fix whatever the compiler points at in jsa-source.ts, which is the only
 * file that calls SketchUpApi.
 *
 * Only add what we actually call, and copy names and shapes from the docs.
 */

export {};

declare global {
  namespace SU {
    interface ObserverHandle {
      stop(): void;
    }

    /** An entity's identifier, for findEntity and friends. Not the same as `id`. */
    interface SketchupId {
      type: number;
      value: number;
    }

    type EntityName = 'Edge' | 'Face' | 'Group' | 'ComponentInstance' | 'ComponentDefinition';

    type EntityFilter =
      | { types: EntityName[] }
      | { visible: boolean }
      | { and: EntityFilter[] }
      | { or: EntityFilter[] }
      | { not: EntityFilter };

    interface EntityQuery {
      filterBy?: EntityFilter;
    }

    /** Properties every entity snapshot has. Snapshots are read-only. */
    interface EntityBase {
      readonly id: number;
      readonly sketchupId: SketchupId;
      /** A value from SketchUpApi.EntityType. */
      readonly type: number;
      readonly typeName: string;
    }

    interface Face extends EntityBase {
      readonly hidden: boolean;
    }

    interface Edge extends EntityBase {
      readonly hidden: boolean;
    }

    interface Group extends EntityBase {
      readonly name: string | undefined;
      readonly definitionId: number;
      readonly entities: Entities;
      readonly hidden: boolean;
      readonly locked: boolean;
    }

    interface ComponentInstance extends EntityBase {
      readonly name: string | undefined;
      readonly definitionId: number;
      readonly hidden: boolean;
      readonly locked: boolean;
    }

    interface ComponentDefinition extends EntityBase {
      readonly name: string;
      readonly isGroup: boolean;
      readonly isImage: boolean;
      readonly isInternal: boolean;
      readonly entities: Entities;
    }

    type DrawingElement = Face | Edge | Group | ComponentInstance | ComponentDefinition;

    interface Entities {
      get(options?: EntityQuery): Promise<DrawingElement[]>;
    }

    interface Selection {
      readonly drawingElements: readonly DrawingElement[];
      readonly totalNumberOfElements: number;
    }

    interface SelectionMetadata {
      readonly totalNumberOfElements: number;
      readonly matchingDrawingElements: number;
      readonly isCurve: boolean;
      readonly isSurface: boolean;
    }

    type ActivePathEntity = Group | ComponentInstance;

    type Point3Like = Point3d | readonly [number, number, number];

    interface Point3d {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }

    interface Vector3d {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }

    interface BoundingBox {
      readonly min: Point3d;
      readonly max: Point3d;
    }

    interface Transformation {
      applyTo(point: Point3Like): Point3d;
    }

    /** The groups and components open for editing, outermost first. Empty at the top level. */
    interface ActivePath {
      readonly path: ActivePathEntity[];
      /** Local coordinates of the open group → world coordinates. */
      readonly transform: Transformation;
    }

    /** Immutable: the with* methods return a new camera. */
    interface Camera {
      readonly direction: Vector3d;
      readonly up: Vector3d;
      /** Degrees. Perspective cameras only. */
      readonly fieldOfView: number;
      readonly data: { readonly type: string };
      withOrientation(eye: Point3Like, target: Point3Like, up: Vector3d): Camera;
      /** Inches. Parallel (orthographic) cameras only. */
      withHeight(height: number): Camera;
    }

    interface View {
      getCamera(): Promise<Camera>;
      setCamera(camera: Camera, transitionTimeSeconds?: number): Promise<void>;
    }

    interface Operation {
      modelSetActivePath(path: ActivePathEntity[]): void;
    }

    type OperationInProgressResolution = 'error' | 'queue' | { queueUpTo: { millis: number } };

    interface OperationOptions {
      disableUi?: boolean;
      transparent?: boolean;
      whenOperationInProgress?: OperationInProgressResolution;
    }

    interface Model {
      readonly id: number;
      readonly guid: string;
      /** Display name. Empty until the model has been saved. */
      readonly title: string;
      readonly revision: number;
      readonly entities: Entities;
      readonly view: View;
      getDefinitions(): Promise<readonly ComponentDefinition[]>;
      getActivePath(): Promise<ActivePath>;
      /** The whole model's bounds, in world coordinates. */
      getBounds(): Promise<BoundingBox>;
      /** Calls back right away, then whenever the user opens or closes a group. */
      observeActivePath(callback: (activePath: ActivePath) => void): ObserverHandle;
      getEntitiesBoundsByIds(ids: readonly SketchupId[]): Promise<BoundingBox[]>;
      getSelection(options?: EntityQuery): Promise<Selection>;
      observeSelectionMetadata(
        callback: (metadata: SelectionMetadata) => void,
        options?: EntityQuery
      ): ObserverHandle;
      updateSelection(
        drawingElements: DrawingElement | readonly DrawingElement[],
        updateType: 'add' | 'remove' | 'replace' | 'toggle'
      ): Promise<SelectionMetadata>;
      performOperation<T>(
        instructions: (operation: Operation) => Promise<T> | T,
        name: string,
        options?: OperationOptions
      ): Promise<T>;
    }

    /** Delivered by observeActiveModel after commits, undo, redo, or a model switch. */
    interface ModelRevision {
      readonly id: number;
      readonly revision: number;
      isDifferentModel(previous: ModelRevision): boolean;
      isModelChanged(previous: ModelRevision): boolean;
      getModel(): Promise<Model>;
    }

    interface UICommandEvent {
      id: string;
      timestamp: number;
    }

    interface UI {
      on(commandId: string, handler: (event: UICommandEvent) => void): void;
    }

    interface ConnectOptions {
      whenOperationInProgress?: OperationInProgressResolution;
      replaceAlreadyConnected?: boolean;
      queryChunkBatchSize?: number;
    }

    interface Sketchup {
      readonly version: string;
      readonly ui: UI;
      readonly EntityType: {
        readonly Edge: 1;
        readonly Face: 2;
        readonly Group: 3;
        readonly ComponentInstance: 4;
        readonly ComponentDefinition: 5;
      };
      isInSketchUp(): boolean;
      connect(options?: ConnectOptions): Promise<unknown>;
      disconnect(): Promise<void>;
      getActiveModel(): Promise<Model>;
      observeActiveModel(callback: (revision: ModelRevision) => void): ObserverHandle;
    }
  }

  /** Set by the SDK script in index.html. Missing if the CDN didn't load. */
  var SketchUpApi: SU.Sketchup | undefined;
}
