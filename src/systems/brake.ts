import {
  createComponent,
  createSystem,
  Entity,
  eq,
  Grabbed,
  OneHandGrabbable,
} from "@iwsdk/core";
import { Task, ActiveTask, TaskCompleteRequested } from "./task.js";
import { TaskId } from "./task-config.js";
import { MoveDone, MoveTo, TeleportTo } from "./animation.js";
import { Highlight, STOP_HIGHLIGHT_COLOR } from "./highlight.js";
import { Recording, BrakeRecordingStopArmed, StopRecording } from "./recording.js";
import { requestReleaseGrab } from "./interaction-gate.js";
import { playSnap } from "../audio/sfx.js";

const BRAKE_SHIFT_X = 0.035;
export const BRAKE_PLAY = { x: -0.1, y: 0.16, z: 0.0725 };
export const BRAKE_STOP = {
  x: BRAKE_PLAY.x + BRAKE_SHIFT_X,
  y: BRAKE_PLAY.y,
  z: BRAKE_PLAY.z,
};

export const Brake = createComponent("Brake", {});
export const BrakeShifted = createComponent("BrakeShifted", {});
export const BrakeReturning = createComponent("BrakeReturning", {});
export const BrakeReleased = createComponent("BrakeReleased", {});

const BRAKE_SHIFT_DURATION_MS = 300;

export class BrakeSystem extends createSystem({
  activeBrakeShiftTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.RecordingBrakeRelease)],
  },
  activePlaybackBrakeShiftTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.PlaybackBrakeRelease)],
  },
  activeRecordingSpeakNarrateTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.RecordingSpeakNarrate)],
  },
  brakeStopArmed: { required: [Brake, BrakeRecordingStopArmed] },
  activePlaybackTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.PlaybackListen)],
  },
  brake: { required: [Brake] },
  brakeGrabbed: {
    required: [Brake, Grabbed],
    excluded: [MoveTo, BrakeShifted, BrakeReturning],
  },
  brakeGrabbedToStopRecording: {
    required: [Brake, Grabbed],
    excluded: [MoveTo, BrakeReturning],
  },
  brakeShiftDone: { required: [Brake, MoveDone, BrakeShifted] },
  brakeReturnDone: { required: [Brake, MoveDone, BrakeReturning] },
}) {
  init() {
    this.cleanupFuncs.push(
      this.queries.activeBrakeShiftTask.subscribe(
        "qualify",
        () => this.onManualBrakeShiftQualify(),
        true,
      ),

      this.queries.activePlaybackBrakeShiftTask.subscribe(
        "qualify",
        () => this.onManualBrakeShiftQualify(),
        true,
      ),

      this.queries.activeBrakeShiftTask.subscribe("disqualify", () => {
        this.onManualBrakeShiftDisqualify();
      }),

      this.queries.activePlaybackBrakeShiftTask.subscribe("disqualify", () => {
        this.onManualBrakeShiftDisqualify();
      }),

      this.queries.brakeStopArmed.subscribe("qualify", (brake) => {
        this.activateRecordingStop(brake);
      }),

      this.queries.brakeStopArmed.subscribe("disqualify", (brake) => {
        this.deactivateRecordingStop(brake);
      }),

      this.queries.activeRecordingSpeakNarrateTask.subscribe("disqualify", () => {
        const brake = this.first(this.queries.brake.entities);
        if (!brake) return;
        this.deactivateRecordingStop(brake);
        brake
          .removeComponent(BrakeReturning)
          .removeComponent(BrakeReleased)
          .removeComponent(MoveTo);
        this.teleportBrake(brake, BRAKE_STOP);
      }),

      this.queries.activePlaybackTask.subscribe("disqualify", () => {
        const brake = this.first(this.queries.brake.entities);
        if (brake) this.returnBrakeAfterPlayback(brake);
      }),

      this.queries.brakeGrabbed.subscribe("qualify", (brake) => {
        if (!this.isManualBrakeShiftActive()) return;
        this.shiftBrake(brake);
      }),

      this.queries.brakeGrabbedToStopRecording.subscribe("qualify", (brake) => {
        if (this.queries.activeRecordingSpeakNarrateTask.entities.size === 0) return;
        if (!brake.hasComponent(BrakeRecordingStopArmed)) return;
        this.stopRecordingWithBrake(brake);
      }),

      this.queries.brakeShiftDone.subscribe("qualify", (brake) => {
        if (!this.isManualBrakeShiftActive()) return;
        this.completeBrakeShiftTask(brake);
      }),

      this.queries.brakeReturnDone.subscribe("qualify", (brake) => {
        this.finishReturnHome(brake);
      }),
    );
  }

  private isManualBrakeShiftActive(): boolean {
    return (
      this.queries.activeBrakeShiftTask.entities.size > 0 ||
      this.queries.activePlaybackBrakeShiftTask.entities.size > 0
    );
  }

  private onManualBrakeShiftQualify(): void {
    const brake = this.first(this.queries.brake.entities);
    if (!brake?.object3D) return;

    brake
      .removeComponent(BrakeReturning)
      .removeComponent(BrakeShifted)
      .removeComponent(BrakeReleased)
      .removeComponent(MoveTo);
    requestReleaseGrab(brake);
    this.teleportBrake(brake, BRAKE_STOP);
    brake.object3D.visible = true;

    brake
      .removeComponent(Highlight)
      .removeComponent(OneHandGrabbable)
      .addComponent(OneHandGrabbable)
      .addComponent(Highlight);
  }

  private onManualBrakeShiftDisqualify(): void {
    const brake = this.first(this.queries.brake.entities);
    if (!brake) return;

    brake
      .removeComponent(BrakeShifted)
      .removeComponent(MoveTo);
    requestReleaseGrab(brake);

    if (
      this.queries.activeRecordingSpeakNarrateTask.entities.size > 0 &&
      brake.hasComponent(BrakeRecordingStopArmed)
    ) {
      this.activateRecordingStop(brake);
      return;
    }

    if (this.queries.activePlaybackTask.entities.size > 0) {
      this.setBrakeAtPlay(brake);
      return;
    }

    brake.removeComponent(OneHandGrabbable).removeComponent(Highlight);
  }

  private activateRecordingStop(brake: Entity): void {
    if (!brake.object3D) return;

    brake.removeComponent(BrakeReturning);
    requestReleaseGrab(brake);
    this.teleportBrake(brake, BRAKE_PLAY);
    brake.object3D.visible = true;

    brake
      .removeComponent(Highlight)
      .removeComponent(OneHandGrabbable)
      .addComponent(OneHandGrabbable)
      .addComponent(Highlight, { color: STOP_HIGHLIGHT_COLOR });
  }

  private setBrakeAtPlay(brake: Entity): void {
    if (!brake.object3D) return;

    brake.removeComponent(BrakeReturning);
    requestReleaseGrab(brake, { removeGrabbable: true });
    brake.removeComponent(Highlight);

    this.teleportBrake(brake, BRAKE_PLAY);
    brake.object3D.visible = true;
  }

  private returnBrakeAfterPlayback(brake: Entity): void {
    if (brake.hasComponent(MoveTo)) {
      brake.removeComponent(MoveTo);
    }

    this.animateBrakeTo(brake, BRAKE_STOP, BrakeReturning);
  }

  private shiftBrake(brake: Entity): void {
    if (
      !brake.object3D ||
      brake.hasComponent(MoveTo) ||
      brake.hasComponent(BrakeShifted)
    ) {
      return;
    }

    requestReleaseGrab(brake, { removeGrabbable: true });
    brake
      .removeComponent(Highlight)
      .addComponent(BrakeShifted);

    this.animateBrakeTo(brake, BRAKE_PLAY, BrakeShifted);
  }

  private stopRecordingWithBrake(brake: Entity): void {
    if (
      brake.hasComponent(BrakeReturning) ||
      brake.hasComponent(MoveTo) ||
      !this.world.sceneEntity.hasComponent(Recording)
    ) {
      return;
    }

    if (!brake.object3D) return;

    this.world.sceneEntity.addComponent(StopRecording);
    requestReleaseGrab(brake, { removeGrabbable: true });
    brake.removeComponent(BrakeRecordingStopArmed);
    this.deactivateRecordingStop(brake);
    this.animateBrakeTo(brake, BRAKE_STOP, BrakeReturning);
  }

  private animateBrakeTo(
    brake: Entity,
    target: { x: number; y: number; z: number },
    marker: typeof BrakeShifted | typeof BrakeReturning,
  ): void {
    if (!brake.object3D) return;

    if (brake.hasComponent(marker)) {
      brake.removeComponent(marker);
    }
    brake.addComponent(marker);
    brake.addComponent(MoveTo, {
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
      duration: BRAKE_SHIFT_DURATION_MS,
    });

    playSnap();
  }

  private finishReturnHome(brake: Entity): void {
    this.teleportBrake(brake, BRAKE_STOP);
    brake.removeComponent(BrakeReturning).removeComponent(BrakeReleased);
  }

  private completeBrakeShiftTask(brake: Entity): void {
    if (!brake.hasComponent(BrakeShifted)) return;

    this.teleportBrake(brake, BRAKE_PLAY);
    brake.removeComponent(BrakeShifted).addComponent(BrakeReleased);

    for (const task of this.queries.activeBrakeShiftTask.entities) {
      if (!task.hasComponent(TaskCompleteRequested)) {
        task.addComponent(TaskCompleteRequested);
      }
    }
    for (const task of this.queries.activePlaybackBrakeShiftTask.entities) {
      if (!task.hasComponent(TaskCompleteRequested)) {
        task.addComponent(TaskCompleteRequested);
      }
    }
  }

  private deactivateRecordingStop(brake: Entity): void {
    requestReleaseGrab(brake, { removeGrabbable: true });
    brake.removeComponent(Highlight);
  }

  private teleportBrake(
    brake: Entity,
    target: { x: number; y: number; z: number },
  ): void {
    brake.addComponent(TeleportTo, {
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
    });
  }

  private first(entities: Iterable<Entity>): Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
