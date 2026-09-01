import { createSystem, Entity, Grabbed } from "@iwsdk/core";
import { stopTaskNarration } from "../audio/narration.js";
import { playTaskChime } from "../audio/sfx.js";
import {
  cancelAllStaleGrabs,
} from "./interaction-gate.js";
import { PhonographPart } from "./phonograph.js";
import { revealPart } from "./part-reveal.js";
import { StartCarriageRecording, StartRecordingSession } from "./recording.js";
import {
  Task,
  ActiveTask,
  TaskCompleteRequested,
} from "./task.js";
import {
  TaskId,
  TASK_BY_ID,
  TASK_ORDER,
} from "./task-config.js";

export const ACTIVE_TASK_FILTER = {
  required: [Task, ActiveTask],
  excluded: [TaskCompleteRequested],
};

export class TaskFlowSystem extends createSystem({
  taskCompleteRequested: {
    required: [Task, ActiveTask, TaskCompleteRequested],
  },
  activeTask: ACTIVE_TASK_FILTER,
  grabbed: { required: [Grabbed] },
  parts: { required: [PhonographPart] },
}) {
  private activeTaskEntity: Entity | null = null;
  private pendingStartRecordingTaskId: string | null = null;
  private pendingAutoCompleteTaskId: string | null = null;

  init() {
    this.cleanupFuncs.push(
      this.queries.activeTask.subscribe("qualify", (entity) => {
        const taskId = entity.getValue(Task, "id")!;
        const task = TASK_BY_ID[taskId];
        if (!task) return;

        this.activeTaskEntity = entity;

        if (task.autoCompleteOnStart) {
          this.pendingAutoCompleteTaskId = taskId;
          return;
        }

        if (task.interactive) {
          cancelAllStaleGrabs(this.queries.grabbed.entities);
        }

        if (task.revealPart) {
          const revealId = task.revealPartId ?? task.partId;
          if (revealId) {
            const part = this.partById(revealId);
            if (part) revealPart(part);
          }
        }

        if (task.startRecordingOnStart) {
          this.pendingStartRecordingTaskId = taskId;
        }
      }),

      this.queries.activeTask.subscribe("disqualify", (entity) => {
        const taskId = entity.getValue(Task, "id")!;
        const task = TASK_BY_ID[taskId];
        if (!task) return;

        if (this.activeTaskEntity?.index === entity.index) {
          stopTaskNarration();
          this.activeTaskEntity = null;
        }
        if (this.pendingStartRecordingTaskId === taskId) {
          this.pendingStartRecordingTaskId = null;
        }
      }),
    );
  }

  update() {
    this.processTaskCompletions();
    this.processAutoCompleteOnStart();
    this.processPendingRecordingOnStart();
  }

  private processTaskCompletions(): void {
    for (const entity of [...this.queries.taskCompleteRequested.entities]) {
      const completedId = entity.getValue(Task, "id")!;
      const completedTask = TASK_BY_ID[completedId];
      if (!completedTask) continue;

      stopTaskNarration();

      if (completedTask.revealOnComplete) {
        const part = this.partById(completedTask.revealOnComplete);
        if (part) revealPart(part);
      }

      playTaskChime();
      entity.removeComponent(ActiveTask);
      entity.removeComponent(TaskCompleteRequested);

      if (this.activeTaskEntity?.index === entity.index) {
        this.activeTaskEntity = null;
      }

      this.advance(completedId);
      entity.dispose();
    }
  }

  private processAutoCompleteOnStart(): void {
    if (!this.pendingAutoCompleteTaskId) return;
    const taskId = this.pendingAutoCompleteTaskId;
    this.pendingAutoCompleteTaskId = null;

    for (const entity of this.queries.activeTask.entities) {
      if (entity.getValue(Task, "id") !== taskId) continue;
      if (!entity.hasComponent(TaskCompleteRequested)) {
        entity.addComponent(TaskCompleteRequested);
      }
      return;
    }
  }

  private processPendingRecordingOnStart(): void {
    const taskId = this.pendingStartRecordingTaskId;
    if (!taskId) return;
    this.pendingStartRecordingTaskId = null;

    let stillActive = false;
    for (const task of this.queries.activeTask.entities) {
      if (task.getValue(Task, "id") === taskId) {
        stillActive = true;
        break;
      }
    }
    if (!stillActive) return;

    this.world.sceneEntity
      .addComponent(StartRecordingSession)
      .addComponent(StartCarriageRecording);
  }

  private advance(completedId: string): void {
    const nextId = this.nextTaskId(completedId);
    if (!nextId) return;

    this.world
      .createEntity()
      .addComponent(ActiveTask)
      .addComponent(Task, { id: nextId });
  }

  private nextTaskId(currentId: string): string | undefined {
    const index = TASK_ORDER.indexOf(currentId);
    if (index < 0) return undefined;
    return TASK_ORDER[(index + 1) % TASK_ORDER.length];
  }

  private partById(id: string): Entity | undefined {
    for (const part of this.queries.parts.entities) {
      if (part.getValue(PhonographPart, "id") === id) return part;
    }
    return undefined;
  }
}
