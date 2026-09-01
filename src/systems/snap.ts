import {
  createComponent,
  createSystem,
  Entity,
  Grabbed,
  OneHandGrabbable,
  Types,
  Vector3,
} from "@iwsdk/core";
import { MoveTo, PopIn, PopOut, PopOutDone } from "./animation.js";
import { playSnap } from "../audio/sfx.js";
import { isCarriageSnapPoint, reparentObject3D } from "./carriage.js";

export const Snappable = createComponent("Snappable", {
  snapRadius: { type: Types.Float32, default: 0.15 },
  snapPointId: { type: Types.String, default: "" },
});
export const SnapPoint = createComponent("SnapPoint", {
  id: { type: Types.String, default: "" },
});
export const Snapped = createComponent("Snapped", {
  snapPointId: { type: Types.String, default: "" },
});
export const SnapGhost = createComponent("SnapGhost", {});

export class SnapSystem extends createSystem({
  snappables: {
    required: [Snappable],
    excluded: [Snapped, Grabbed],
  },
  snappedAndGrabbed: { required: [Snappable, Snapped, Grabbed] },
  snapPoints: { required: [SnapPoint] },
  grabbedWithSnapGhost: {
    required: [Snappable, SnapGhost, Grabbed],
    excluded: [Snapped],
  },
  snappedWithGhost: { required: [Snappable, SnapGhost, Snapped] },
  ghostPoppedOut: { required: [SnapPoint, PopOutDone] },
}) {
  private _pos1!: Vector3;
  private _pos2!: Vector3;

  init() {
    this._pos1 = new Vector3();
    this._pos2 = new Vector3();

    this.cleanupFuncs.push(
      this.queries.snappables.subscribe("qualify", (entity) => {
        this.trySnap(entity);
      }),
      this.queries.snappedAndGrabbed.subscribe("qualify", (entity) => {
        this.unsnap(entity);
      }),

      this.queries.grabbedWithSnapGhost.subscribe("qualify", (entity) => {
        const sp = this.snapPointFor(entity);
        if (!sp?.object3D) return;
        sp.removeComponent(PopOut);
        sp.object3D.visible = true;
        sp.addComponent(PopIn);
      }),

      this.queries.grabbedWithSnapGhost.subscribe("disqualify", (entity) => {
        if (entity.hasComponent(Snapped)) return;
        const sp = this.snapPointFor(entity);
        if (!sp) return;
        sp.removeComponent(PopIn);
        sp.addComponent(PopOut);
      }),

      this.queries.snappedWithGhost.subscribe("qualify", (entity) => {
        const sp = this.snapPointFor(entity);
        if (!sp?.object3D) return;
        sp.removeComponent(PopIn).removeComponent(PopOut);
        sp.object3D.visible = false;
      }),

      this.queries.ghostPoppedOut.subscribe("qualify", (sp) => {
        if (sp.object3D) sp.object3D.visible = false;
      }),
    );
  }

  private unsnap(entity: Entity) {
    entity.removeComponent(Snapped);
    entity.removeComponent(MoveTo);
    entity.addComponent(OneHandGrabbable);
  }

  private trySnap(entity: Entity) {
    const snapRadius = entity.getValue(Snappable, "snapRadius")!;
    const targetId = entity.getValue(Snappable, "snapPointId");

    entity.object3D!.getWorldPosition(this._pos1);

    for (const point of this.queries.snapPoints.entities) {
      const pointId = point.getValue(SnapPoint, "id");
      if (targetId && pointId !== targetId) continue;

      point.object3D!.getWorldPosition(this._pos2);

      if (this._pos1.distanceTo(this._pos2) < snapRadius) {
        this.executeSnap(entity, point);
        return;
      }
    }
  }

  private executeSnap(entity: Entity, point: Entity) {
    const pointObj = point.object3D!;
    const entityObj = entity.object3D!;

    const snapPointId = point.getValue(SnapPoint, "id")!;
    if (isCarriageSnapPoint(snapPointId) && pointObj.parent && entityObj.parent !== pointObj.parent) {
      reparentObject3D(entityObj, pointObj.parent);
    }

    const targetPos = pointObj.position;
    const targetQuat = pointObj.quaternion;

    entity.removeComponent(OneHandGrabbable);
    entity.addComponent(Snapped, {
      snapPointId: point.getValue(SnapPoint, "id")!,
    });
    entity.addComponent(MoveTo, {
      targetX: targetPos.x,
      targetY: targetPos.y,
      targetZ: targetPos.z,
      targetQX: targetQuat.x,
      targetQY: targetQuat.y,
      targetQZ: targetQuat.z,
      targetQW: targetQuat.w,
      useTargetRotation: true,
    });

    playSnap();
  }

  private snapPointFor(entity: Entity): Entity | undefined {
    const targetId = entity.getValue(Snappable, "snapPointId");
    if (!targetId) return undefined;
    for (const sp of this.queries.snapPoints.entities) {
      if (sp.getValue(SnapPoint, "id") === targetId) return sp;
    }
    return undefined;
  }
}
