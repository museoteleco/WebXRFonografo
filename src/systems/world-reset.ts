import { createSystem, Entity, eq, Grabbed, OneHandGrabbable } from "@iwsdk/core";
import { Task, ActiveTask, TaskCompleteRequested } from "./task.js";
import { TaskId } from "./task-config.js";
import { PhonographPart } from "./phonograph.js";
import {
  Phonograph,
  PhonographPlaced,
  PhonographSpawnAnchor,
} from "./phonograph.js";
import {
  Carriage,
  CarriageMesh,
  CarriageLowering,
  CarriageReturning,
  CarriageTraveling,
} from "./carriage.js";
import { BrakeShifted, BrakeReturning, BrakeReleased } from "./brake.js";
import { CrankHeld, CrankingComplete, CrankRotation } from "./crank.js";
import { Highlight } from "./highlight.js";
import { MountTaskBinding } from "./mount.js";
import { MoveTo, PopIn, PopInDone, PopOut, Spin, TeleportTo } from "./animation.js";
import { Snappable, Snapped, SnapGhost, SnapPoint } from "./snap.js";
import { TaskPanel, TaskPanelAutoComplete } from "./task-panel.js";
import { Unmounting, UnmountPopping } from "./unmount.js";
import {
  BrakeRecordingStopArmed,
  ClearRecording,
  Recording,
  StartCarriageRecording,
  StartCarvingAmbience,
  StartRecordingSession,
  StopRecording,
} from "./recording.js";
import { cancelActiveGrab, ReleaseGrab } from "./interaction-gate.js";
import { StartPlacement } from "./placement.js";
import {
  PartNameTag,
  PartNameTagPendingSpawn,
} from "./part-info.js";
import { CARRIAGE_LAYOUT, isCarriagePart, reparentObject3D } from "./carriage.js";
import { PART_LAYOUT } from "./spawn.js";

const GAMEPLAY_COMPONENTS = [
  MountTaskBinding,
  OneHandGrabbable,
  Grabbed,
  Snappable,
  Snapped,
  SnapGhost,
  MoveTo,
  TeleportTo,
  ReleaseGrab,
  Unmounting,
  UnmountPopping,
  Highlight,
  PopIn,
  PopInDone,
  PopOut,
  Spin,
  CrankHeld,
  CrankingComplete,
  CrankRotation,
  BrakeShifted,
  BrakeReturning,
  BrakeReleased,
  BrakeRecordingStopArmed,
  CarriageLowering,
  CarriageReturning,
  CarriageTraveling,
  TaskPanel,
  TaskPanelAutoComplete,
  PartNameTag,
  PartNameTagPendingSpawn,
] as const;

export class WorldResetSystem extends createSystem({
  activeMainMenuTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.Welcome)],
  },
  phonograph: { required: [Phonograph] },
  parts: { required: [PhonographPart] },
  snapPoints: { required: [SnapPoint] },
  carriage: { required: [Carriage] },
  carriageMesh: { required: [CarriageMesh] },
  spawnAnchors: { required: [PhonographSpawnAnchor] },
}) {
  init() {
    this.cleanupFuncs.push(
      this.queries.activeMainMenuTask.subscribe("qualify", () => {
        this.resetWorld();
      }),
    );
  }

  private resetWorld(): void {
    this.world.sceneEntity
      .removeComponent(StartPlacement)
      .removeComponent(StartRecordingSession)
      .removeComponent(StartCarriageRecording)
      .removeComponent(StartCarvingAmbience)
      .removeComponent(StopRecording)
      .removeComponent(Recording);
    this.world.sceneEntity.addComponent(ClearRecording);

    for (const phonograph of this.queries.phonograph.entities) {
      cancelActiveGrab(phonograph);
      if (phonograph.object3D) phonograph.object3D.visible = false;
      phonograph.removeComponent(PhonographPlaced);
      this.stripGameplay(phonograph);
    }

    const phonographRoot = this.first(this.queries.phonograph.entities)?.object3D;

    for (const layout of PART_LAYOUT) {
      const part = this.partById(layout.id);
      if (!part?.object3D) continue;
      cancelActiveGrab(part);
      if (phonographRoot && isCarriagePart(layout.id)) {
        this.reparentPartToPhonographStaging(part, phonographRoot);
      } else {
        part.addComponent(TeleportTo, {
          targetX: layout.position[0],
          targetY: layout.position[1],
          targetZ: layout.position[2],
          targetQX: layout.quaternion[0],
          targetQY: layout.quaternion[1],
          targetQZ: layout.quaternion[2],
          targetQW: layout.quaternion[3],
          useTargetRotation: true,
        });
      }
      part.object3D.scale.setScalar(layout.visible ? 1 : 0.001);
      part.object3D.visible = layout.visible;
      if (layout.id === "crank") {
        const pivot = part.object3D.getObjectByName("__crankPivot");
        if (pivot) pivot.rotation.x = 0;
      }
      this.stripGameplay(part);
    }

    for (const carriage of this.queries.carriage.entities) {
      if (!carriage.object3D) continue;
      cancelActiveGrab(carriage);
      carriage.addComponent(TeleportTo, {
        targetX: CARRIAGE_LAYOUT.position[0],
        targetY: CARRIAGE_LAYOUT.position[1],
        targetZ: CARRIAGE_LAYOUT.position[2],
        targetQX: CARRIAGE_LAYOUT.quaternion[0],
        targetQY: CARRIAGE_LAYOUT.quaternion[1],
        targetQZ: CARRIAGE_LAYOUT.quaternion[2],
        targetQW: CARRIAGE_LAYOUT.quaternion[3],
        useTargetRotation: true,
      });
      carriage.object3D.visible = true;
      this.stripGameplay(carriage);
    }

    for (const mesh of this.queries.carriageMesh.entities) {
      cancelActiveGrab(mesh);
      this.stripGameplay(mesh);
    }

    for (const anchor of [...this.queries.spawnAnchors.entities]) {
      anchor.dispose();
    }

    for (const snapPoint of this.queries.snapPoints.entities) {
      if (!snapPoint.object3D) continue;
      snapPoint.removeComponent(PopIn).removeComponent(PopOut);
      snapPoint.object3D.scale.setScalar(0.001);
      snapPoint.object3D.visible = false;
    }
  }

  private reparentPartToPhonographStaging(
    part: Entity,
    phonographRoot: import("@iwsdk/core").Object3D,
  ): void {
    const partId = part.getValue(PhonographPart, "id");
    const layout = PART_LAYOUT.find((entry) => entry.id === partId);
    if (!layout) return;

    const obj = part.object3D;
    if (!obj) return;

    if (obj.parent !== phonographRoot) {
      reparentObject3D(obj, phonographRoot);
    }

    part.addComponent(TeleportTo, {
      targetX: layout.position[0],
      targetY: layout.position[1],
      targetZ: layout.position[2],
      targetQX: layout.quaternion[0],
      targetQY: layout.quaternion[1],
      targetQZ: layout.quaternion[2],
      targetQW: layout.quaternion[3],
      useTargetRotation: true,
    });
  }

  private stripGameplay(entity: Entity): void {
    for (const component of GAMEPLAY_COMPONENTS) {
      entity.removeComponent(component);
    }
  }

  private partById(id: string): Entity | undefined {
    for (const part of this.queries.parts.entities) {
      if (part.getValue(PhonographPart, "id") === id) return part;
    }
    return undefined;
  }

  private first(entities: Iterable<Entity>): Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
