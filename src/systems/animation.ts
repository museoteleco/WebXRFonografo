import {
  createComponent,
  createSystem,
  Entity,
  PanelDocument,
  Quaternion,
  Types,
  UIKit,
  UIKitDocument,
  Vector3,
} from "@iwsdk/core";

export const POP_IN_MS = 700;
export const POP_OUT_MS = 550;
export const SPIN_PERIOD_MS = 1000;

export function isPartPopInComplete(part: Entity): boolean {
  if (part.hasComponent(PopInDone)) return true;
  const obj = part.object3D;
  if (!obj?.visible) return false;
  if (!part.hasComponent(PopIn)) return obj.scale.x >= 0.9;
  return obj.scale.x >= 0.9;
}

const POP_FIELDS = {
  elapsed: { type: Types.Float32, default: 0 },
  from: { type: Types.Float32, default: -1 },
  target: { type: Types.Float32, default: 1 },
} as const;

export const PopIn = createComponent("PopIn", { ...POP_FIELDS });
export const PopIn2D = createComponent("PopIn2D", { ...POP_FIELDS });
export const PopOut = createComponent("PopOut", { ...POP_FIELDS });
export const PopOut2D = createComponent("PopOut2D", { ...POP_FIELDS });

export const PopInDone = createComponent("PopInDone", {});
export const PopOutDone = createComponent("PopOutDone", {});
export const PopIn2DDone = createComponent("PopIn2DDone", {});
export const PopOut2DDone = createComponent("PopOut2DDone", {});
export const MoveDone = createComponent("MoveDone", {});

export const Spin = createComponent("Spin", {});

export const DEFAULT_MOVE_DURATION_MS = 300;

export const TeleportTo = createComponent("TeleportTo", {
  targetX: { type: Types.Float32, default: 0 },
  targetY: { type: Types.Float32, default: 0 },
  targetZ: { type: Types.Float32, default: 0 },
  targetQX: { type: Types.Float32, default: 0 },
  targetQY: { type: Types.Float32, default: 0 },
  targetQZ: { type: Types.Float32, default: 0 },
  targetQW: { type: Types.Float32, default: 1 },
  useTargetRotation: { type: Types.Boolean, default: false },
});

export const MoveTo = createComponent("MoveTo", {
  targetX: { type: Types.Float32, default: 0 },
  targetY: { type: Types.Float32, default: 0 },
  targetZ: { type: Types.Float32, default: 0 },
  targetQX: { type: Types.Float32, default: 0 },
  targetQY: { type: Types.Float32, default: 0 },
  targetQZ: { type: Types.Float32, default: 0 },
  targetQW: { type: Types.Float32, default: 1 },
  useTargetRotation: { type: Types.Boolean, default: false },
  duration: { type: Types.Float32, default: DEFAULT_MOVE_DURATION_MS },
  linear: { type: Types.Boolean, default: false },
  elapsed: { type: Types.Float32, default: 0 },
  started: { type: Types.Boolean, default: false },
  fromX: { type: Types.Float32, default: 0 },
  fromY: { type: Types.Float32, default: 0 },
  fromZ: { type: Types.Float32, default: 0 },
  fromQX: { type: Types.Float32, default: 0 },
  fromQY: { type: Types.Float32, default: 0 },
  fromQZ: { type: Types.Float32, default: 0 },
  fromQW: { type: Types.Float32, default: 1 },
});

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInCubic = (t: number) => t * t * t;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

type PopComponent =
  | typeof PopIn
  | typeof PopOut
  | typeof PopIn2D
  | typeof PopOut2D;

type DoneTag =
  | typeof PopInDone
  | typeof PopOutDone
  | typeof PopIn2DDone
  | typeof PopOut2DDone
  | typeof MoveDone;

export class AnimationSystem extends createSystem({
  popIn: { required: [PopIn] },
  popIn2D: { required: [PopIn2D] },
  popOut: { required: [PopOut] },
  popOut2D: { required: [PopOut2D] },
  popInDone: { required: [PopInDone] },
  popOutDone: { required: [PopOutDone] },
  popIn2DDone: { required: [PopIn2DDone] },
  popOut2DDone: { required: [PopOut2DDone] },
  moveDone: { required: [MoveDone] },
  spin: { required: [Spin] },
  moveTo: { required: [MoveTo] },
  teleportTo: { required: [TeleportTo] },
  panelDocuments: { required: [PanelDocument] },
}) {
  private fromPos!: Vector3;
  private toPos!: Vector3;
  private fromQuat!: Quaternion;
  private toQuat!: Quaternion;
  private finished: Entity[] = [];
  private doneBuffer: Entity[] = [];
  private panelRoots = new WeakMap<
    Entity,
    { document: UIKitDocument; root: UIKit.Component }
  >();

  init() {
    this.fromPos = new Vector3();
    this.toPos = new Vector3();
    this.fromQuat = new Quaternion();
    this.toQuat = new Quaternion();

    const resetPop = (entity: Entity, component: PopComponent) => {
      entity.setValue(component, "elapsed", 0);
      entity.setValue(component, "from", -1);
    };
    this.cleanupFuncs.push(
      this.queries.popIn.subscribe("qualify", (e) => {
        if (e.object3D) e.object3D.visible = true;
        resetPop(e, PopIn);
      }),
      this.queries.popOut.subscribe("qualify", (e) => resetPop(e, PopOut)),
      this.queries.popIn2D.subscribe("qualify", (e) => resetPop(e, PopIn2D)),
      this.queries.popOut2D.subscribe("qualify", (e) => resetPop(e, PopOut2D)),
      this.queries.moveTo.subscribe("qualify", (e) => {
        e.setValue(MoveTo, "started", false);
        e.setValue(MoveTo, "elapsed", 0);
      }),
      this.queries.teleportTo.subscribe("qualify", (e) => this.applyTeleport(e)),
      this.queries.panelDocuments.subscribe("disqualify", (e) => {
        this.panelRoots.delete(e);
      }),
    );
  }

  update(delta: number) {
    this.sweepDone(this.queries.popInDone.entities, PopInDone);
    this.sweepDone(this.queries.popOutDone.entities, PopOutDone);
    this.sweepDone(this.queries.popIn2DDone.entities, PopIn2DDone);
    this.sweepDone(this.queries.popOut2DDone.entities, PopOut2DDone);
    this.sweepDone(this.queries.moveDone.entities, MoveDone);

    const dtMs = delta * 1000;

    this.advancePop3D(this.queries.popIn.entities, PopIn, 1, POP_IN_MS, easeOutCubic, dtMs, PopInDone);
    this.advancePop3D(this.queries.popOut.entities, PopOut, 0.001, POP_OUT_MS, easeInCubic, dtMs, PopOutDone);
    this.advancePop2D(this.queries.popIn2D.entities, PopIn2D, 1, POP_IN_MS, easeOutCubic, dtMs, PopIn2DDone);
    this.advancePop2D(this.queries.popOut2D.entities, PopOut2D, 0.001, POP_OUT_MS, easeInCubic, dtMs, PopOut2DDone);
    this.advanceSpin(dtMs);
    this.advanceMove(dtMs);
  }

  private sweepDone(entities: Iterable<Entity>, tag: DoneTag): void {
    this.doneBuffer.length = 0;
    for (const entity of entities) this.doneBuffer.push(entity);
    for (const entity of this.doneBuffer) entity.removeComponent(tag);
  }

  private advancePop3D(
    entities: Iterable<Entity>,
    component: PopComponent,
    target: number,
    durationMs: number,
    easing: (t: number) => number,
    dtMs: number,
    doneTag?: DoneTag,
  ): void {
    this.finished.length = 0;
    for (const entity of entities) {
      const obj = entity.object3D;
      if (!obj) continue;

      let from = entity.getValue(component, "from")!;
      if (from < 0) {
        from = obj.scale.x;
        entity.setValue(component, "from", from);
      }

      const popTarget =
        component === PopIn ? entity.getValue(PopIn, "target")! : target;

      const elapsed = entity.getValue(component, "elapsed")! + dtMs;
      const t = Math.min(elapsed / durationMs, 1);
      obj.scale.setScalar(from + (popTarget - from) * easing(t));

      if (t >= 1) this.finished.push(entity);
      else entity.setValue(component, "elapsed", elapsed);
    }
    this.finishPop(component, doneTag);
  }

  private advancePop2D(
    entities: Iterable<Entity>,
    component: PopComponent,
    target: number,
    durationMs: number,
    easing: (t: number) => number,
    dtMs: number,
    doneTag?: DoneTag,
  ): void {
    this.finished.length = 0;
    for (const entity of entities) {
      const root = this.panelRoot(entity);
      if (!root) continue;

      let from = entity.getValue(component, "from")!;
      if (from < 0) {
        from = root.scale.x;
        entity.setValue(component, "from", from);
      }

      const elapsed = entity.getValue(component, "elapsed")! + dtMs;
      const t = Math.min(elapsed / durationMs, 1);
      root.scale.setScalar(from + (target - from) * easing(t));

      if (t >= 1) this.finished.push(entity);
      else entity.setValue(component, "elapsed", elapsed);
    }
    this.finishPop(component, doneTag);
  }

  private finishPop(component: PopComponent, doneTag?: DoneTag): void {
    for (const entity of this.finished) {
      entity.removeComponent(component);
      if (doneTag) entity.addComponent(doneTag);
    }
  }

  private advanceSpin(dtMs: number): void {
    const step = (Math.PI * 2 * dtMs) / SPIN_PERIOD_MS;
    for (const entity of this.queries.spin.entities) {
      if (entity.object3D) entity.object3D.rotation.x += step;
    }
  }

  private advanceMove(dtMs: number): void {
    this.finished.length = 0;
    for (const entity of this.queries.moveTo.entities) {
      const obj = entity.object3D;
      if (!obj) continue;

      if (!entity.getValue(MoveTo, "started")) {
        entity.setValue(MoveTo, "started", true);
        entity.setValue(MoveTo, "elapsed", 0);
        entity.setValue(MoveTo, "fromX", obj.position.x);
        entity.setValue(MoveTo, "fromY", obj.position.y);
        entity.setValue(MoveTo, "fromZ", obj.position.z);
        entity.setValue(MoveTo, "fromQX", obj.quaternion.x);
        entity.setValue(MoveTo, "fromQY", obj.quaternion.y);
        entity.setValue(MoveTo, "fromQZ", obj.quaternion.z);
        entity.setValue(MoveTo, "fromQW", obj.quaternion.w);

        if (!entity.getValue(MoveTo, "useTargetRotation")) {
          entity.setValue(MoveTo, "targetQX", obj.quaternion.x);
          entity.setValue(MoveTo, "targetQY", obj.quaternion.y);
          entity.setValue(MoveTo, "targetQZ", obj.quaternion.z);
          entity.setValue(MoveTo, "targetQW", obj.quaternion.w);
        }
      }

      const duration = entity.getValue(MoveTo, "duration")!;
      const elapsed = entity.getValue(MoveTo, "elapsed")! + dtMs;
      const t = Math.min(elapsed / duration, 1);
      const linear = entity.getValue(MoveTo, "linear") ?? false;
      const eased = linear ? t : easeOutBack(t);

      this.fromPos.set(
        entity.getValue(MoveTo, "fromX")!,
        entity.getValue(MoveTo, "fromY")!,
        entity.getValue(MoveTo, "fromZ")!,
      );
      this.toPos.set(
        entity.getValue(MoveTo, "targetX")!,
        entity.getValue(MoveTo, "targetY")!,
        entity.getValue(MoveTo, "targetZ")!,
      );
      this.fromQuat.set(
        entity.getValue(MoveTo, "fromQX")!,
        entity.getValue(MoveTo, "fromQY")!,
        entity.getValue(MoveTo, "fromQZ")!,
        entity.getValue(MoveTo, "fromQW")!,
      );
      this.toQuat.set(
        entity.getValue(MoveTo, "targetQX")!,
        entity.getValue(MoveTo, "targetQY")!,
        entity.getValue(MoveTo, "targetQZ")!,
        entity.getValue(MoveTo, "targetQW")!,
      );

      obj.position.lerpVectors(this.fromPos, this.toPos, eased);
      obj.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, eased);

      if (t >= 1) {
        obj.position.copy(this.toPos);
        obj.quaternion.copy(this.toQuat);
        this.finished.push(entity);
      } else {
        entity.setValue(MoveTo, "elapsed", elapsed);
      }
    }
    for (const entity of this.finished) {
      entity.removeComponent(MoveTo);
      entity.addComponent(MoveDone);
    }
  }

  private applyTeleport(entity: Entity): void {
    const obj = entity.object3D;
    if (!obj) {
      entity.removeComponent(TeleportTo);
      return;
    }

    obj.position.set(
      entity.getValue(TeleportTo, "targetX")!,
      entity.getValue(TeleportTo, "targetY")!,
      entity.getValue(TeleportTo, "targetZ")!,
    );

    if (entity.getValue(TeleportTo, "useTargetRotation")) {
      obj.quaternion.set(
        entity.getValue(TeleportTo, "targetQX")!,
        entity.getValue(TeleportTo, "targetQY")!,
        entity.getValue(TeleportTo, "targetQZ")!,
        entity.getValue(TeleportTo, "targetQW")!,
      );
    }

    entity.removeComponent(TeleportTo);
  }

  private panelRoot(entity: Entity): UIKit.Component | undefined {
    const doc = entity.getValue(PanelDocument, "document") as
      | UIKitDocument
      | null;
    if (!doc) return undefined;

    const cached = this.panelRoots.get(entity);
    if (cached?.document === doc) return cached.root;

    const root = doc?.getElementById("panel-root") as UIKit.Component | undefined;
    if (root) this.panelRoots.set(entity, { document: doc, root });
    return root;
  }
}
