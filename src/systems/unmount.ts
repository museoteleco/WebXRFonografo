import {
  createComponent,
  createSystem,
  Entity,
  Grabbed,
  OneHandGrabbable,
  Types,
} from "@iwsdk/core";
import { Task, ActiveTask, TaskCompleteRequested } from "./task.js";
import { Phonograph } from "./phonograph.js";
import { PhonographPart } from "./phonograph.js";
import { MoveTo, PopOut, PopOutDone, TeleportTo } from "./animation.js";
import { ReleaseGrab } from "./interaction-gate.js";
import { Highlight, STOP_HIGHLIGHT_COLOR } from "./highlight.js";
import { Snappable, SnapGhost, Snapped } from "./snap.js";
import { UNMOUNT_BY_TASK } from "./task-config.js";
import { isCarriagePart, reparentObject3D } from "./carriage.js";
import { PART_LAYOUT } from "./spawn.js";
import { playPop } from "../audio/sfx.js";
import { MountTaskBinding } from "./mount.js";

export const Unmounting = createComponent("Unmounting", {
  taskId: { type: Types.String, default: "" },
});
export const UnmountPopping = createComponent("UnmountPopping", {});

export class UnmountSystem extends createSystem({
  activeTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
  },
  parts: { required: [PhonographPart] },
  phonograph: { required: [Phonograph] },
  grabbedWhileUnmounting: {
    required: [Unmounting, Grabbed],
    excluded: [PopOut, UnmountPopping],
  },
  unmountDone: { required: [Unmounting, PopOutDone] },
}) {
  init() {
    this.cleanupFuncs.push(
      this.queries.activeTask.subscribe("qualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        if (!UNMOUNT_BY_TASK[taskId]) return;
        const part = this.partById(UNMOUNT_BY_TASK[taskId].partId);
        if (part) this.activateUnmount(part, taskId);
      }),

      this.queries.activeTask.subscribe("disqualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        if (!UNMOUNT_BY_TASK[taskId]) return;
        const part = this.partById(UNMOUNT_BY_TASK[taskId].partId);
        part?.removeComponent(Unmounting);
      }),

      this.queries.grabbedWhileUnmounting.subscribe("qualify", (part) => {
        this.finishUnmount(part);
      }),

      this.queries.unmountDone.subscribe("qualify", (part) => {
        this.completeUnmount(part);
      }),
    );
  }

  private activateUnmount(part: Entity, taskId: string): void {
    part.object3D!.visible = true;
    part
      .addComponent(Unmounting, { taskId })
      .removeComponent(Snapped)
      .removeComponent(SnapGhost)
      .removeComponent(Snappable)
      .removeComponent(MountTaskBinding)
      .addComponent(OneHandGrabbable)
      .addComponent(Highlight, { color: STOP_HIGHLIGHT_COLOR });
  }

  private finishUnmount(part: Entity): void {
    if (!part.hasComponent(Unmounting) || part.hasComponent(UnmountPopping)) {
      return;
    }

    part.addComponent(UnmountPopping);
    part.addComponent(ReleaseGrab, { removeGrabbable: true });

    part
      .removeComponent(Highlight)
      .removeComponent(Snappable)
      .removeComponent(SnapGhost)
      .removeComponent(Snapped)
      .removeComponent(MoveTo)
      .addComponent(PopOut);

    playPop();
  }

  private completeUnmount(part: Entity): void {
    const taskId = part.getValue(Unmounting, "taskId");
    part.addComponent(ReleaseGrab, { removeGrabbable: true });
    part.removeComponent(Unmounting).removeComponent(UnmountPopping);

    const partId = part.getValue(PhonographPart, "id");
    const phonograph = this.first(this.queries.phonograph.entities);
    if (isCarriagePart(partId) && phonograph?.object3D) {
      this.reparentPartToPhonographStaging(part, phonograph.object3D);
    }

    const obj = part.object3D;
    if (obj) {
      obj.scale.setScalar(0.001);
      obj.visible = false;
    }

    if (!taskId) return;

    for (const task of this.queries.activeTask.entities) {
      if (task.getValue(Task, "id") === taskId) {
        task.addComponent(TaskCompleteRequested);
      }
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
