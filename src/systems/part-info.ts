import {
  createComponent,
  createSystem,
  Entity,
  eq,
  FollowBehavior,
  Follower,
  Grabbed,
  Object3D,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  Types,
  UIKit,
  UIKitDocument,
} from "@iwsdk/core";
import {
  isPartPopInComplete,
  PopIn2D,
  PopIn2DDone,
  PopInDone,
  PopOut,
  PopOut2D,
  PopOut2DDone,
} from "./animation.js";
import { Billboard } from "./billboard.js";
import {
  beginPanelPopOut,
  hidePanelEntity,
  stripPanelSurface,
} from "./panel-lifecycle.js";
import { resumeAudioContext } from "../audio/context.js";
import { playInfoDetailNarration } from "../audio/narration.js";
import { resolveLocalePath } from "../locale.js";
import { PhonographPart } from "./phonograph.js";
import { Snapped } from "./snap.js";
import { Task, ActiveTask, TaskCompleteRequested } from "./task.js";
import { NAME_TAGS_BY_TASK, TASK_BY_ID, TaskId } from "./task-config.js";
import { DismissTaskInstruction } from "./instruction.js";
import { BrakeRecordingStopArmed } from "./recording.js";
import {
  DETAIL_PANEL_MAX_WIDTH,
  NAME_TAG_MAX_WIDTH,
  PANEL_OFFSET_Y,
  nameTagSpecForTaskPart,
} from "./part-info-config.js";

const PANEL_FOLLOW_SPEED = 12;
const PANEL_FOLLOW_TOLERANCE = 0.05;

export const PartNameTag = createComponent("PartNameTag", {
  nameTagConfig: { type: Types.String, default: "" },
  detailConfig: { type: Types.String, default: "" },
  maxWidth: { type: Types.Float32, default: NAME_TAG_MAX_WIDTH },
  detailMaxWidth: { type: Types.Float32, default: DETAIL_PANEL_MAX_WIDTH },
  offsetX: { type: Types.Float32, default: 0 },
  offsetY: { type: Types.Float32, default: PANEL_OFFSET_Y },
  offsetZ: { type: Types.Float32, default: 0 },
  infoButtonId: { type: Types.String, default: "" },
  detailNarration: { type: Types.String, default: "" },
});

export const PartNameTagInstance = createComponent("PartNameTagInstance", {
  part: { type: Types.Entity, default: null },
});

export const PartNameTagWired = createComponent("PartNameTagWired", {});
export const PartNameTagPendingSpawn = createComponent("PartNameTagPendingSpawn", {});
export const PartNameTagSwappingOut = createComponent("PartNameTagSwappingOut", {
  part: { type: Types.Entity, default: null },
  popOutStarted: { type: Types.Boolean, default: false },
});

export const PartInfoDetailInstance = createComponent("PartInfoDetailInstance", {
  part: { type: Types.Entity, default: null },
});
export const PartInfoDetailWired = createComponent("PartInfoDetailWired", {});
export const PartInfoDetailSwappingOut = createComponent("PartInfoDetailSwappingOut", {
  part: { type: Types.Entity, default: null },
  popOutStarted: { type: Types.Boolean, default: false },
});

export const PartInfoDetailNarrationActive = createComponent(
  "PartInfoDetailNarrationActive",
  {},
);

export const InfoTutorialCompleteOnDetailClose = createComponent(
  "InfoTutorialCompleteOnDetailClose",
  {},
);

export const DetailPendingCloseAfterRelease = createComponent(
  "DetailPendingCloseAfterRelease",
  { panel: { type: Types.Entity, default: null } },
);

const DISABLE_NAME_TAG_GRAB_POPOUT = true;

export class PartInfoSystem extends createSystem({
  parts: { required: [PhonographPart] },
  activeTask: { required: [Task, ActiveTask], excluded: [TaskCompleteRequested] },
  infoTutorialTask: {
    required: [Task, ActiveTask, InfoTutorialCompleteOnDetailClose],
    excluded: [TaskCompleteRequested],
  },
  partDetailPendingRelease: {
    required: [PhonographPart, DetailPendingCloseAfterRelease],
    excluded: [Grabbed],
  },
  snappedParts: { required: [PhonographPart, Snapped] },
  taggedParts: { required: [PartNameTag] },
  taggedPartsPopInDone: { required: [PartNameTag, PopInDone] },
  taggedPartsPopOut: { required: [PartNameTag, PopOut] },
  taggedPartsGrabbed: { required: [PartNameTag, Grabbed] },
  nameTagPendingSpawn: {
    required: [PartNameTag, PartNameTagPendingSpawn],
  },
  nameTagInstances: { required: [PartNameTagInstance] },
  nameTagDocs: { required: [PartNameTagInstance, PanelDocument] },
  wiredNameTags: {
    required: [PartNameTagInstance, PartNameTagWired],
  },
  nameTagSwapPopOutDone: {
    required: [PartNameTagInstance, PartNameTagSwappingOut, PopOut2DDone],
  },
  detailInstances: { required: [PartInfoDetailInstance] },
  detailDocs: { required: [PartInfoDetailInstance, PanelDocument] },
  wiredDetails: {
    required: [PartInfoDetailInstance, PartInfoDetailWired],
  },
  detailSwapPopOutDone: {
    required: [PartInfoDetailInstance, PartInfoDetailSwappingOut, PopOut2DDone],
  },
  detailNarrationActive: {
    required: [PartInfoDetailInstance, PartInfoDetailNarrationActive],
  },
  nameTagPopInDone: { required: [PartNameTagInstance, PopIn2DDone] },
  detailPopInDone: {
    required: [PartInfoDetailInstance, PopIn2DDone],
    excluded: [PartInfoDetailSwappingOut, PartInfoDetailNarrationActive],
  },
  brakeRecordingStopArmed: {
    required: [PhonographPart, BrakeRecordingStopArmed],
    where: [eq(PhonographPart, "id", "brake")],
  },
}) {
  private pendingNameTagWiring: Entity[] = [];
  private pendingNameTagWiringRetry: Entity[] = [];
  private pendingDetailWiring: Entity[] = [];
  private pendingDetailNarration: Entity[] = [];
  private pendingNameTagPoke: Entity[] = [];
  private pendingRecordingBrakeNameTags: Entity[] = [];
  private cancelDetailAutoClose: (() => void) | null = null;

  init() {
    this.cleanupFuncs.push(
      this.queries.activeTask.subscribe("qualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        this.applyNameTagForTask(taskId);
      }),

      this.queries.activeTask.subscribe("disqualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        this.removeNameTagForTask(taskId);
        if (taskId === TaskId.RecordingSpeakNarrate) {
          const brake = this.partById("brake");
          if (brake) this.removeRecordingBrakeNameTag(brake);
        }
        this.cancelDetailAutoClose?.();
        this.cancelDetailAutoClose = null;
      }),

      this.queries.brakeRecordingStopArmed.subscribe("qualify", (brake) => {
        if (!this.isRecordingSpeakNarrateActive()) return;
        this.applyRecordingBrakeNameTag(brake);
      }),

      this.queries.brakeRecordingStopArmed.subscribe("disqualify", (brake) => {
        this.removeRecordingBrakeNameTag(brake);
      }),

      this.queries.partDetailPendingRelease.subscribe("qualify", (part) => {
        const panel = part.getValue(DetailPendingCloseAfterRelease, "panel");
        part.removeComponent(DetailPendingCloseAfterRelease);
        if (panel?.active && !panel.hasComponent(PartInfoDetailSwappingOut)) {
          this.beginCloseDetail(panel);
        }
      }),

      this.queries.snappedParts.subscribe("qualify", (part) => {
        const partId = part.getValue(PhonographPart, "id");
        const taskId = this.getActiveTaskId();
        if (partId && taskId && this.allowsSnappedNameTag(taskId, partId)) {
          return;
        }
        this.removePartNameTag(part);
      }),

      this.queries.taggedParts.subscribe("qualify", (part) => {
        this.trySpawnNameTag(part);
      }),

      this.queries.taggedPartsPopInDone.subscribe("qualify", (part) => {
        this.trySpawnNameTag(part);
      }),

      this.queries.taggedPartsPopOut.subscribe("qualify", (part) => {
        this.destroyNameTagPanelsForPart(part);
      }),

      this.queries.nameTagSwapPopOutDone.subscribe("qualify", (panel) => {
        this.onNameTagSwapPopOutDone(panel);
      }),

      this.queries.detailSwapPopOutDone.subscribe("qualify", (panel) => {
        this.onDetailSwapPopOutDone(panel);
      }),

      this.queries.taggedParts.subscribe("disqualify", (part) => {
        part.removeComponent(PartNameTagPendingSpawn);
        this.destroyNameTagPanelsForPart(part);
      }),

      this.queries.nameTagPendingSpawn.subscribe("qualify", () => {
        for (const part of this.queries.nameTagPendingSpawn.entities) {
          this.trySpawnNameTag(part);
        }
      }),

      this.queries.taggedPartsGrabbed.subscribe("qualify", (part) => {
        this.hidePartPanels(part);
      }),

      this.queries.taggedPartsGrabbed.subscribe("disqualify", (part) => {
        this.showPartPanels(part);
      }),

      this.queries.nameTagDocs.subscribe("qualify", (panel) => {
        this.popInPanel(panel);
        this.pendingNameTagWiring.push(panel);

        const part = panel.getValue(PartNameTagInstance, "part");
        if (
          part?.active &&
          this.isInfoNameTag(part) &&
          !panel.hasComponent(PartNameTagSwappingOut)
        ) {
          this.pendingNameTagPoke.push(panel);
        }
      }),

      this.queries.detailDocs.subscribe("qualify", (panel) => {
        this.popInPanel(panel);
        this.pendingDetailWiring.push(panel);
        this.pendingDetailNarration.push(panel);
      }),

      this.queries.nameTagPopInDone.subscribe("qualify", (panel) => {
        const part = panel.getValue(PartNameTagInstance, "part");
        if (
          part?.active &&
          this.isInfoNameTag(part) &&
          !panel.hasComponent(PartNameTagSwappingOut)
        ) {
          this.pendingNameTagPoke.push(panel);
        }
      }),

      this.queries.detailPopInDone.subscribe("qualify", (panel) => {
        if (!this.pendingDetailNarration.includes(panel)) {
          this.pendingDetailNarration.push(panel);
        }
      }),
      () => {
        this.cancelDetailAutoClose?.();
        this.cancelDetailAutoClose = null;
      },
    );

    for (const part of this.queries.taggedParts.entities) {
      this.trySpawnNameTag(part);
    }
  }

  update() {
    this.processPendingWiring();
    this.processPendingDetailNarration();
    this.processPendingNameTagPoke();
    this.processPendingRecordingBrakeNameTags();
    for (const part of this.queries.nameTagPendingSpawn.entities) {
      this.trySpawnNameTag(part);
    }
  }

  private onNameTagSwapPopOutDone(nameTagPanel: Entity): void {
    if (!nameTagPanel.active) return;
    if (!nameTagPanel.getValue(PartNameTagSwappingOut, "popOutStarted")) return;

    const part = nameTagPanel.getValue(PartNameTagSwappingOut, "part");
    nameTagPanel.removeComponent(PartNameTagSwappingOut);
    if (nameTagPanel.object3D) nameTagPanel.object3D.visible = false;

    if (part?.active) {
      this.spawnDetailPanel(part);
      this.onInfoDetailOpened(part);
    }
  }

  private onDetailSwapPopOutDone(detailPanel: Entity): void {
    if (!detailPanel.active) return;
    if (!detailPanel.getValue(PartInfoDetailSwappingOut, "popOutStarted")) return;

    const part = detailPanel.getValue(PartInfoDetailSwappingOut, "part");
    this.teardownDetailPanel(detailPanel);

    if (part?.active) {
      if (!this.shouldSkipNameTagRestore(part)) {
        this.restoreNameTag(part);
      }
      this.onInfoDetailClosed(part);
    }
  }

  private processPendingWiring(): void {
    this.pendingNameTagWiringRetry.length = 0;
    for (const panel of this.pendingNameTagWiring) {
      if (!panel.active) continue;
      if (!this.wireNameTag(panel)) {
        this.pendingNameTagWiringRetry.push(panel);
      }
    }
    const nextNameTagWiring = this.pendingNameTagWiringRetry;
    this.pendingNameTagWiringRetry = this.pendingNameTagWiring;
    this.pendingNameTagWiring = nextNameTagWiring;

    for (const panel of this.pendingDetailWiring) {
      if (panel.active) this.wireDetailPanel(panel);
    }
    this.pendingDetailWiring.length = 0;
  }

  private processPendingRecordingBrakeNameTags(): void {
    for (const brake of this.pendingRecordingBrakeNameTags) {
      if (!brake.active || brake.hasComponent(Snapped) || brake.hasComponent(PartNameTag)) {
        continue;
      }
      const spec = nameTagSpecForTaskPart(TaskId.RecordingSpeakNarrate, "brake");
      if (!spec) continue;
      brake.addComponent(PartNameTag, spec);
    }
    this.pendingRecordingBrakeNameTags.length = 0;
  }

  private processPendingDetailNarration(): void {
    for (const panel of this.pendingDetailNarration) {
      if (!panel.active || panel.hasComponent(PartInfoDetailSwappingOut)) continue;
      if (panel.hasComponent(PartInfoDetailNarrationActive)) continue;

      const part = panel.getValue(PartInfoDetailInstance, "part");
      if (part?.active) {
        this.startDetailAutoClose(part, panel);
      }
    }
    this.pendingDetailNarration.length = 0;
  }

  private processPendingNameTagPoke(): void {
    for (const panel of this.pendingNameTagPoke) {
      if (
        !panel.active ||
        panel.hasComponent(PartNameTagSwappingOut) ||
        panel.hasComponent(PokeInteractable)
      ) {
        continue;
      }
      panel.addComponent(PokeInteractable);
    }
    this.pendingNameTagPoke.length = 0;
  }

  private canSpawnNameTag(part: Entity): boolean {
    return isPartPopInComplete(part);
  }

  private trySpawnNameTag(part: Entity): void {
    if (!part.object3D?.visible) {
      if (!part.hasComponent(PartNameTagPendingSpawn)) {
        part.addComponent(PartNameTagPendingSpawn);
      }
      return;
    }

    const existing = this.findNameTagForPart(part);
    if (existing) {
      if (this.needsNameTagRestore(part, existing)) {
        this.restoreNameTag(part);
      }
      part.removeComponent(PartNameTagPendingSpawn);
      return;
    }

    if (
      this.canSpawnNameTag(part) &&
      !this.findNameTagForPart(part) &&
      !this.hasActiveDetailForPart(part) &&
      !this.isDetailClosingForPart(part) &&
      !this.isNameTagSwappingOut(part)
    ) {
      part.removeComponent(PartNameTagPendingSpawn);
      this.spawnNameTag(part);
      return;
    }

    if (!part.hasComponent(PartNameTagPendingSpawn)) {
      part.addComponent(PartNameTagPendingSpawn);
    }
  }

  private needsNameTagRestore(part: Entity, nameTag: Entity): boolean {
    if (this.hasActiveDetailForPart(part)) return false;
    if (nameTag.hasComponent(PartNameTagSwappingOut)) return false;
    if (!nameTag.object3D) return false;
    if (!nameTag.hasComponent(PanelDocument)) return false;
    if (nameTag.hasComponent(PopIn2D) || nameTag.hasComponent(PopOut2D)) {
      return false;
    }
    return !nameTag.object3D.visible;
  }

  private partPanelOffset(
    part: Entity,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
  ): [number, number, number] {
    return [offsetX, offsetY, offsetZ];
  }

  private nameTagPanelOffset(part: Entity): [number, number, number] {
    return this.partPanelOffset(
      part,
      part.getValue(PartNameTag, "offsetX") ?? 0,
      part.getValue(PartNameTag, "offsetY") ?? PANEL_OFFSET_Y,
      part.getValue(PartNameTag, "offsetZ") ?? 0,
    );
  }

  private partPanelFollower(
    part: Entity,
    target: Object3D,
    offsetPosition: [number, number, number],
  ) {
    return {
      behavior: FollowBehavior.NoRotation,
      target,
      offsetPosition,
      speed: PANEL_FOLLOW_SPEED,
      tolerance: PANEL_FOLLOW_TOLERANCE,
    };
  }

  private spawnNameTag(part: Entity): void {
    const partObj = part.object3D;
    if (!partObj?.visible) return;

    const existing = this.findNameTagForPart(part);
    if (existing) {
      this.teardownNameTag(existing);
    }

    const config = resolveLocalePath(part.getValue(PartNameTag, "nameTagConfig")!);
    const maxWidth = part.getValue(PartNameTag, "maxWidth") ?? NAME_TAG_MAX_WIDTH;

    const panel = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PanelUI, { config, maxWidth })
      .addComponent(PartNameTagInstance, { part })
      .addComponent(
        Follower,
        this.partPanelFollower(part, partObj, this.nameTagPanelOffset(part)),
      )
      .addComponent(Billboard);

    panel.object3D!.scale.setScalar(0.001);
    panel.object3D!.visible = true;
  }

  private spawnDetailPanel(part: Entity): void {
    const partObj = part.object3D;
    if (!partObj?.visible) return;

    const existing = this.findDetailForPart(part);
    if (existing) {
      this.teardownDetailPanel(existing);
    }

    const detailConfig = part.getValue(PartNameTag, "detailConfig");
    if (!detailConfig) return;

    const maxWidth =
      part.getValue(PartNameTag, "detailMaxWidth") ?? DETAIL_PANEL_MAX_WIDTH;

    const panel = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PanelUI, {
        config: resolveLocalePath(detailConfig),
        maxWidth,
      })
      .addComponent(PartInfoDetailInstance, { part })
      .addComponent(
        Follower,
        this.partPanelFollower(part, partObj, this.nameTagPanelOffset(part)),
      )
      .addComponent(Billboard);

    panel.object3D!.scale.setScalar(0.001);
    panel.object3D!.visible = true;
  }

  private isInfoNameTag(part: Entity): boolean {
    return !!(
      part.getValue(PartNameTag, "infoButtonId") ||
      part.getValue(PartNameTag, "detailConfig")
    );
  }

  private wireNameTag(panel: Entity): boolean {
    if (!panel.active || this.isNameTagWired(panel)) return true;

    const part = panel.getValue(PartNameTagInstance, "part");
    if (!part?.active || !part.hasComponent(PartNameTag)) return true;

    const buttonId = part.getValue(PartNameTag, "infoButtonId") ?? "";
    if (!buttonId) {
      panel.addComponent(PartNameTagWired);
      return true;
    }

    const doc = panel.getValue(PanelDocument, "document") as UIKitDocument | null;
    const button = doc?.getElementById(buttonId);
    if (!button) return false;

    button.addEventListener("pointerdown", () => {
      void resumeAudioContext();
      this.beginOpenDetail(part, panel);
    });

    panel.addComponent(PartNameTagWired);
    return true;
  }

  private wireDetailPanel(panel: Entity): void {
    if (!panel.active || this.isDetailWired(panel)) return;
    if (!panel.hasComponent(PartInfoDetailInstance)) return;
    panel.addComponent(PartInfoDetailWired);
  }

  private beginOpenDetail(part: Entity, nameTagPanel: Entity): void {
    if (
      !nameTagPanel.active ||
      nameTagPanel.hasComponent(PartNameTagSwappingOut) ||
      this.hasActiveDetailForPart(part)
    ) {
      return;
    }

    if (this.getActiveTaskId() === TaskId.AssemblyPhonographInfo) {
      this.world.sceneEntity.addComponent(DismissTaskInstruction, {
        taskId: TaskId.AssemblyPhonographInfo,
      });
    }

    nameTagPanel.addComponent(PartNameTagSwappingOut, {
      part,
      popOutStarted: true,
    });
    beginPanelPopOut(nameTagPanel);
  }

  private beginCloseDetail(detailPanel: Entity): void {
    if (!detailPanel.active || detailPanel.hasComponent(PartInfoDetailSwappingOut)) {
      return;
    }

    const part = detailPanel.getValue(PartInfoDetailInstance, "part");
    if (part?.active) {
      this.finalizeInfoTutorialBeforeDetailClose(part);
    }

    detailPanel.addComponent(PartInfoDetailSwappingOut, {
      part,
      popOutStarted: true,
    });
    beginPanelPopOut(detailPanel);
  }

  private restoreNameTag(part: Entity): void {
    if (!part.hasComponent(PartNameTag)) return;

    const nameTag = this.findNameTagForPart(part);
    if (!nameTag?.active || !nameTag.object3D) {
      this.spawnNameTag(part);
      return;
    }

    nameTag.object3D.visible = true;
    nameTag.removeComponent(PartNameTagSwappingOut);
    this.popInPanel(nameTag);
  }

  private hidePartPanels(part: Entity): void {
    if (DISABLE_NAME_TAG_GRAB_POPOUT) return;

    const nameTag = this.findNameTagForPart(part);
    if (nameTag && !nameTag.hasComponent(PartNameTagSwappingOut)) {
      this.popOutPanelOnGrab(nameTag);
    }
  }

  private popOutPanelOnGrab(panel: Entity): void {
    if (!panel.active || !panel.object3D?.visible) return;
    if (panel.hasComponent(PopOut2D)) return;
    beginPanelPopOut(panel);
  }

  private showPartPanels(part: Entity): void {
    if (this.hasActiveDetailForPart(part)) {
      const detail = this.findDetailForPart(part);
      if (
        detail?.object3D &&
        !detail.hasComponent(PartInfoDetailSwappingOut) &&
        (detail.hasComponent(PopOut2D) || !detail.object3D.visible)
      ) {
        detail.object3D.visible = true;
        this.popInPanel(detail);
      }
      return;
    }

    if (DISABLE_NAME_TAG_GRAB_POPOUT) return;

    const nameTag = this.findNameTagForPart(part);
    if (nameTag?.object3D && !nameTag.hasComponent(PartNameTagSwappingOut)) {
      nameTag.object3D.visible = true;
      if (nameTag.hasComponent(PopOut2D) || !nameTag.hasComponent(PopIn2D)) {
        this.popInPanel(nameTag);
      }
    }
  }

  private onInfoDetailOpened(part: Entity): void {
    const taskId = this.getActiveTaskId();
    const task = taskId ? TASK_BY_ID[taskId] : undefined;
    if (!task?.completeOnInfoDetailClose) return;

    for (const taskEntity of this.queries.activeTask.entities) {
      if (!taskEntity.hasComponent(InfoTutorialCompleteOnDetailClose)) {
        taskEntity.addComponent(InfoTutorialCompleteOnDetailClose);
      }
    }
  }

  private onInfoDetailClosed(part: Entity): void {
    this.cancelDetailAutoClose?.();
    this.cancelDetailAutoClose = null;

    for (const task of this.queries.infoTutorialTask.entities) {
      task.addComponent(TaskCompleteRequested);
      break;
    }
  }

  private finalizeInfoTutorialBeforeDetailClose(part: Entity): void {
    const taskId = this.getActiveTaskId();
    const task = taskId ? TASK_BY_ID[taskId] : undefined;
    if (!task?.completeOnInfoDetailClose) return;

    const nameTag = this.findNameTagForPart(part);
    if (nameTag) this.teardownNameTag(nameTag);
  }

  private getActiveTaskId(): string | undefined {
    for (const task of this.queries.activeTask.entities) {
      return task.getValue(Task, "id") ?? undefined;
    }
    return undefined;
  }

  private allowsSnappedNameTag(taskId: string, partId: string): boolean {
    return NAME_TAGS_BY_TASK[taskId]?.includes(partId) ?? false;
  }

  private startDetailAutoClose(part: Entity, panel: Entity): void {
    if (panel.hasComponent(PartInfoDetailNarrationActive)) return;

    panel.addComponent(PartInfoDetailNarrationActive);

    const narration = part.hasComponent(PartNameTag)
      ? (part.getValue(PartNameTag, "detailNarration") ?? "")
      : "";

    this.cancelDetailAutoClose = playInfoDetailNarration(narration, () => {
      if (!panel.active || panel.hasComponent(PartInfoDetailSwappingOut)) return;
      panel.removeComponent(PartInfoDetailNarrationActive);
      this.cancelDetailAutoClose = null;

      const linkedPart = panel.getValue(PartInfoDetailInstance, "part");
      if (linkedPart?.active) {
        this.scheduleOrCloseDetail(linkedPart, panel);
      } else {
        this.beginCloseDetail(panel);
      }
    });
  }

  private scheduleOrCloseDetail(part: Entity, panel: Entity): void {
    if (!panel.active || panel.hasComponent(PartInfoDetailSwappingOut)) return;

    if (part.hasComponent(Grabbed)) {
      if (part.hasComponent(DetailPendingCloseAfterRelease)) {
        part.setValue(DetailPendingCloseAfterRelease, "panel", panel);
      } else {
        part.addComponent(DetailPendingCloseAfterRelease, { panel });
      }
      return;
    }

    this.beginCloseDetail(panel);
  }

  private shouldSkipNameTagRestore(_part: Entity): boolean {
    return [...this.queries.infoTutorialTask.entities].length > 0;
  }

  private destroyNameTagPanelsForPart(part: Entity): void {
    part.removeComponent(PartNameTagPendingSpawn);
    part.removeComponent(DetailPendingCloseAfterRelease);

    const nameTag = this.findNameTagForPart(part);
    if (nameTag) this.teardownNameTag(nameTag);

    const detail = this.findDetailForPart(part);
    if (detail && !detail.hasComponent(PartInfoDetailSwappingOut)) {
      this.teardownDetailPanel(detail);
    }
  }

  private applyNameTagForTask(taskId: string): void {
    const partIds = NAME_TAGS_BY_TASK[taskId];
    if (!partIds?.length) return;

    const activeIds = new Set(partIds);
    for (const part of [...this.queries.taggedParts.entities]) {
      const taggedId = part.getValue(PhonographPart, "id");
      if (!taggedId || !activeIds.has(taggedId)) {
        this.removePartNameTag(part);
      }
    }

    for (const partId of partIds) {
      const part = this.partById(partId);
      if (!part || part.hasComponent(PartNameTag)) {
        continue;
      }
      if (part.hasComponent(Snapped) && !this.allowsSnappedNameTag(taskId, partId)) {
        continue;
      }

      const spec = nameTagSpecForTaskPart(taskId, partId);
      if (!spec) continue;

      part.addComponent(PartNameTag, spec);
    }
  }

  private removeNameTagForTask(taskId: string): void {
    const partIds = NAME_TAGS_BY_TASK[taskId];
    if (!partIds?.length) return;

    for (const partId of partIds) {
      const part = this.partById(partId);
      if (part) this.removePartNameTag(part);
    }
  }

  private removePartNameTag(part: Entity): void {
    if (!part.hasComponent(PartNameTag)) return;
    this.destroyNameTagPanelsForPart(part);
    part.removeComponent(PartNameTag);
  }

  private isRecordingSpeakNarrateActive(): boolean {
    for (const task of this.queries.activeTask.entities) {
      if (task.getValue(Task, "id") === TaskId.RecordingSpeakNarrate) return true;
    }
    return false;
  }

  private applyRecordingBrakeNameTag(brake: Entity): void {
    if (brake.hasComponent(Snapped) || brake.hasComponent(PartNameTag)) return;

    const spec = nameTagSpecForTaskPart(TaskId.RecordingSpeakNarrate, "brake");
    if (!spec) return;

    this.pendingRecordingBrakeNameTags.push(brake);
  }

  private removeRecordingBrakeNameTag(brake: Entity): void {
    if (!brake.hasComponent(PartNameTag)) return;
    this.removePartNameTag(brake);
  }

  private partById(id: string): Entity | undefined {
    for (const part of this.queries.parts.entities) {
      if (part.getValue(PhonographPart, "id") === id) return part;
    }
    return undefined;
  }

  private teardownNameTag(panel: Entity): void {
    panel
      .removeComponent(PartNameTagWired)
      .removeComponent(PartNameTagSwappingOut)
      .removeComponent(PartNameTagInstance);
    hidePanelEntity(panel);
    panel.dispose();
  }

  private teardownDetailPanel(panel: Entity): void {
    if (!panel.active) return;
    this.cancelDetailAutoClose?.();
    this.cancelDetailAutoClose = null;
    panel.removeComponent(PartInfoDetailNarrationActive);
    panel
      .removeComponent(PartInfoDetailWired)
      .removeComponent(PartInfoDetailSwappingOut)
      .removeComponent(PartInfoDetailInstance);
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

  private findNameTagForPart(part: Entity): Entity | undefined {
    for (const panel of this.queries.nameTagInstances.entities) {
      if (panel.getValue(PartNameTagInstance, "part") === part) {
        return panel;
      }
    }
    return undefined;
  }

  private findDetailForPart(part: Entity): Entity | undefined {
    for (const panel of this.queries.detailInstances.entities) {
      if (panel.getValue(PartInfoDetailInstance, "part") === part) {
        return panel;
      }
    }
    return undefined;
  }

  private hasActiveDetailForPart(part: Entity): boolean {
    const detail = this.findDetailForPart(part);
    return (
      !!detail?.active &&
      !detail.hasComponent(PartInfoDetailSwappingOut)
    );
  }

  private isDetailClosingForPart(part: Entity): boolean {
    const detail = this.findDetailForPart(part);
    return !!detail?.active && detail.hasComponent(PartInfoDetailSwappingOut);
  }

  private isNameTagSwappingOut(part: Entity): boolean {
    const nameTag = this.findNameTagForPart(part);
    return !!nameTag?.hasComponent(PartNameTagSwappingOut);
  }

  private isNameTagWired(panel: Entity): boolean {
    for (const wired of this.queries.wiredNameTags.entities) {
      if (wired.index === panel.index) return true;
    }
    return false;
  }

  private isDetailWired(panel: Entity): boolean {
    for (const wired of this.queries.wiredDetails.entities) {
      if (wired.index === panel.index) return true;
    }
    return false;
  }
}
