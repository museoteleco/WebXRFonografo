import {
  createComponent,
  createSystem,
  Entity,
  FollowBehavior,
  Follower,
  PanelDocument,
  PanelUI,
  Types,
  UIKit,
  UIKitDocument,
} from "@iwsdk/core";
import { PopIn2D, PopOut2D, PopOut2DDone } from "./animation.js";
import { Billboard } from "./billboard.js";
import { resolveLocalePath } from "../locale.js";
import { hidePanelEntity, stripPanelSurface } from "./panel-lifecycle.js";
import { Phonograph } from "./phonograph.js";
import { ActiveTask, TaskCompleteRequested, Task } from "./task.js";
import { PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH, TaskId } from "./task-config.js";

const ASSEMBLY_CHECKLIST_CONFIGS = [
  "./ui/{locale}/checklists/chapter-1-assemble-step-1.json",
  "./ui/{locale}/checklists/chapter-1-assemble-step-2.json",
  "./ui/{locale}/checklists/chapter-1-assemble-step-3.json",
];

const RECORDING_CHECKLIST_CONFIGS = [
  "./ui/{locale}/checklists/chapter-2-record-step-1.json",
  "./ui/{locale}/checklists/chapter-2-record-step-2.json",
  "./ui/{locale}/checklists/chapter-2-record-step-3.json",
];

const PLAYBACK_SETUP_CHECKLIST_CONFIGS = [
  "./ui/{locale}/checklists/chapter-3-playback-step-1.json",
  "./ui/{locale}/checklists/chapter-3-playback-step-2.json",
  "./ui/{locale}/checklists/chapter-3-playback-step-3.json",
  "./ui/{locale}/checklists/chapter-3-playback-step-4.json",
  "./ui/{locale}/checklists/chapter-3-playback-step-5.json",
];

const PLAYBACK_LISTEN_CHECKLIST_CONFIGS = [
  "./ui/{locale}/checklists/chapter-4-playback-step-1.json",
  "./ui/{locale}/checklists/chapter-4-playback-step-2.json",
  "./ui/{locale}/checklists/chapter-4-playback-step-3.json",
];

const CHECKLIST_MAX_WIDTH = PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH * 0.85;
const PLAYBACK_SETUP_CHECKLIST_MAX_WIDTH = PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH * 0.9;
const CHECKLIST_OFFSET: [number, number, number] = [0, 0.44, -0.2];

const ASSEMBLY_CHECKLIST_ORDER = [
  TaskId.AssemblyCylinderMount,
  TaskId.AssemblyRecorderMount,
  TaskId.AssemblyRecordingHornMount,
] as const;

const RECORDING_CHECKLIST_ORDER = [
  TaskId.RecordingCrankWind,
  TaskId.RecordingBrakeRelease,
  TaskId.RecordingCarriageLower,
] as const;

const PLAYBACK_SETUP_CHECKLIST_ORDER = [
  TaskId.PlaybackSetupRecordingHornUnmount,
  TaskId.PlaybackSetupRecorderUnmount,
  TaskId.PlaybackSetupCarriageReturn,
  TaskId.PlaybackSetupReproducerMount,
  TaskId.PlaybackSetupListeningHornMount,
] as const;

const PLAYBACK_LISTEN_CHECKLIST_ORDER = [
  TaskId.PlaybackBrakeRelease,
  TaskId.PlaybackCarriageLower,
  TaskId.PlaybackListen,
] as const;

type ChecklistGroup = "assembly" | "recording" | "playbackSetup" | "playbackListen";

interface ChecklistState {
  group: ChecklistGroup;
  step: number;
}

function checklistState(taskId: string): ChecklistState | null {
  const assemblyStep = ASSEMBLY_CHECKLIST_ORDER.indexOf(
    taskId as (typeof ASSEMBLY_CHECKLIST_ORDER)[number],
  );
  if (assemblyStep >= 0) return { group: "assembly", step: assemblyStep };

  const recordingStep = RECORDING_CHECKLIST_ORDER.indexOf(
    taskId as (typeof RECORDING_CHECKLIST_ORDER)[number],
  );
  if (recordingStep >= 0) return { group: "recording", step: recordingStep };

  const playbackSetupStep = PLAYBACK_SETUP_CHECKLIST_ORDER.indexOf(
    taskId as (typeof PLAYBACK_SETUP_CHECKLIST_ORDER)[number],
  );
  if (playbackSetupStep >= 0) {
    return { group: "playbackSetup", step: playbackSetupStep };
  }

  const playbackListenStep = PLAYBACK_LISTEN_CHECKLIST_ORDER.indexOf(
    taskId as (typeof PLAYBACK_LISTEN_CHECKLIST_ORDER)[number],
  );
  if (playbackListenStep >= 0) {
    return { group: "playbackListen", step: playbackListenStep };
  }

  return null;
}

export const ChapterChecklist = createComponent("ChapterChecklist", {
  visible: { type: Types.Boolean, default: false },
});

export const ChapterChecklistInstance = createComponent(
  "ChapterChecklistInstance",
  {
    step: { type: Types.Int8, default: 0 },
  },
);

export class ChapterChecklistSystem extends createSystem({
  activeTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
  },
  phonograph: { required: [Phonograph] },
  anchors: { required: [ChapterChecklist] },
  instances: { required: [ChapterChecklistInstance] },
  checklistDocs: { required: [ChapterChecklistInstance, PanelDocument] },
  poppedOut: { required: [ChapterChecklistInstance, PopOut2DDone] },
}) {
  private currentGroup: ChecklistGroup | null = null;
  private currentStep = 0;

  init() {
    this.cleanupFuncs.push(
      this.queries.activeTask.subscribe("qualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        this.onTaskActive(taskId);
      }),

      this.queries.activeTask.subscribe("disqualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        if (
          taskId === TaskId.AssemblyRecordingHornMount ||
          taskId === TaskId.RecordingCarriageLower ||
          taskId === TaskId.PlaybackSetupListeningHornMount ||
          taskId === TaskId.PlaybackListen
        ) {
          this.hideChecklist();
        }
      }),

      this.queries.anchors.subscribe("qualify", () => {
        this.spawnChecklistPanels();
      }),

      this.queries.anchors.subscribe("disqualify", () => {
        for (const panel of this.queries.instances.entities) {
          this.beginPopOut(panel);
        }
      }),

      this.queries.checklistDocs.subscribe("qualify", (panel) => {
        const step = panel.getValue(ChapterChecklistInstance, "step") ?? 0;
        if (step === this.currentStep) {
          this.popInPanel(panel);
        }
      }),

      this.queries.poppedOut.subscribe("qualify", (panel) => {
        this.teardownPanel(panel);
      }),
    );
  }

  private onTaskActive(taskId: string): void {
    const state = checklistState(taskId);
    if (!state) {
      this.hideChecklist();
      return;
    }

    const groupChanged = this.currentGroup !== state.group;
    this.currentGroup = state.group;
    this.currentStep = state.step;
    this.showChecklist(groupChanged);
    this.updateChecklistVisibility();
  }

  private showChecklist(groupChanged = false): void {
    for (const anchor of this.queries.anchors.entities) {
      if (!anchor.getValue(ChapterChecklist, "visible")) {
        anchor.setValue(ChapterChecklist, "visible", true);
      }
      if (groupChanged) {
        this.teardownAllPanels();
      }
      if (this.queries.instances.entities.size === 0) {
        this.spawnChecklistPanels();
      }
      return;
    }

    const phonograph = this.first(this.queries.phonograph.entities);
    if (!phonograph) return;
    phonograph.addComponent(ChapterChecklist, { visible: true });
  }

  private hideChecklist(): void {
    this.currentGroup = null;
    for (const anchor of this.queries.anchors.entities) {
      anchor.removeComponent(ChapterChecklist);
    }
  }

  private teardownAllPanels(): void {
    for (const panel of [...this.queries.instances.entities]) {
      this.teardownPanel(panel);
    }
  }

  private spawnChecklistPanels(): void {
    if (!this.currentGroup) return;
    const anchor = this.first(this.queries.anchors.entities);
    const anchorObj = anchor?.object3D;
    if (!anchorObj) return;

    const configs =
      this.currentGroup === "assembly"
        ? ASSEMBLY_CHECKLIST_CONFIGS
        : this.currentGroup === "recording"
          ? RECORDING_CHECKLIST_CONFIGS
          : this.currentGroup === "playbackSetup"
            ? PLAYBACK_SETUP_CHECKLIST_CONFIGS
            : PLAYBACK_LISTEN_CHECKLIST_CONFIGS;
    const maxWidth =
      this.currentGroup === "playbackSetup"
        ? PLAYBACK_SETUP_CHECKLIST_MAX_WIDTH
        : CHECKLIST_MAX_WIDTH;

    for (let step = 0; step < configs.length; step += 1) {
      const config = configs[step];
      if (!config) continue;
      const panel = this.world
        .createTransformEntity(undefined, { parent: this.world.sceneEntity })
        .addComponent(PanelUI, {
          config: resolveLocalePath(config),
          maxWidth,
        })
        .addComponent(ChapterChecklistInstance, { step })
        .addComponent(Follower, {
          behavior: FollowBehavior.NoRotation,
          target: anchorObj,
          offsetPosition: CHECKLIST_OFFSET,
        })
        .addComponent(Billboard);

      panel.object3D!.scale.setScalar(0.001);
      panel.object3D!.visible = step === this.currentStep;
    }
  }

  private updateChecklistVisibility(): void {
    for (const panel of this.queries.instances.entities) {
      const step = panel.getValue(ChapterChecklistInstance, "step") ?? 0;
      if (!panel.object3D) continue;
      const shouldShow = step === this.currentStep;
      const wasVisible = panel.object3D.visible;
      panel.object3D.visible = shouldShow;
      if (
        shouldShow &&
        !wasVisible &&
        panel.hasComponent(PanelDocument)
      ) {
        this.popInPanel(panel);
      }
    }
  }

  private beginPopOut(panel: Entity): void {
    if (panel.hasComponent(PopOut2D)) return;
    stripPanelSurface(panel);
    panel.addComponent(PopOut2D);
  }

  private teardownPanel(panel: Entity): void {
    if (!panel.active) return;
    hidePanelEntity(panel);
    panel.dispose();
  }

  private popInPanel(panel: Entity): void {
    if (!panel.active) return;

    const doc = panel.getValue(PanelDocument, "document") as UIKitDocument | null;
    const root = doc?.getElementById("panel-root") as UIKit.Component | undefined;
    if (root) root.scale.setScalar(0.001);

    stripPanelSurface(panel);
    if (!panel.hasComponent(PopIn2D)) {
      panel.addComponent(PopIn2D);
    }
  }

  private first(entities: Iterable<Entity>): Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
