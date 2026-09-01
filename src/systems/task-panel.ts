import {
  createComponent,
  createSystem,
  Entity,
  FollowBehavior,
  Follower,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  Types,
  UIKit,
  UIKitDocument,
} from "@iwsdk/core";
import { Task, ActiveTask, TaskCompleteRequested } from "./task.js";
import { TaskId } from "./task-config.js";
import { Phonograph } from "./phonograph.js";
import { StartPlacement } from "./placement.js";
import { PopIn2D, PopIn2DDone, PopOut2D, PopOut2DDone } from "./animation.js";
import { Billboard } from "./billboard.js";
import {
  beginPanelPopOut,
  hidePanelEntity,
  stripPanelSurface,
} from "./panel-lifecycle.js";
import {
  PHONOGRAPH_ABOVE_OFFSET_Y,
  PHONOGRAPH_PANEL_MAX_WIDTH,
  TASK_PANEL_BY_TASK,
  type TaskPanelSpec,
} from "./task-config.js";
import { resumeAudioContext } from "../audio/context.js";
import { playTaskNarration, stopTaskNarration } from "../audio/narration.js";
import {
  getLocale,
  resolveLocalePath,
  setLocale,
  type Locale,
} from "../locale.js";

export const TaskPanel = createComponent("TaskPanel", {
  panelConfig: { type: Types.String, default: "" },
  taskId: { type: Types.String, default: "" },
  maxWidth: { type: Types.Float32, default: PHONOGRAPH_PANEL_MAX_WIDTH },
  offsetX: { type: Types.Float32, default: 0 },
  offsetY: { type: Types.Float32, default: 0 },
  offsetZ: { type: Types.Float32, default: 0 },
  faceTarget: { type: Types.Boolean, default: false },
  billboard: { type: Types.Boolean, default: false },
  buttonId: { type: Types.String, default: "" },
  deferCompleteOnDismiss: { type: Types.Boolean, default: false },
  autoCompleteMs: { type: Types.Float32, default: 0 },
  narration: { type: Types.String, default: "" },
});

export const TaskPanelInstance = createComponent("TaskPanelInstance", {
  anchor: { type: Types.Entity, default: null },
  taskId: { type: Types.String, default: "" },
});

export const TaskPanelWired = createComponent("TaskPanelWired", {});
export const TaskPanelPendingDismiss = createComponent("TaskPanelPendingDismiss", {});
export const TaskPanelPendingDispose = createComponent("TaskPanelPendingDispose", {});

export const TaskPanelAutoComplete = createComponent("TaskPanelAutoComplete", {
  remainingMs: { type: Types.Float32, default: 0 },
});

export class TaskPanelSystem extends createSystem({
  activeTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
  },
  phonograph: { required: [Phonograph] },
  panelAnchors: { required: [TaskPanel] },
  anchors: { required: [TaskPanel] },
  instances: { required: [TaskPanelInstance] },
  instanceDocs: { required: [TaskPanelInstance, PanelDocument] },
  wiredPanels: { required: [TaskPanelInstance, TaskPanelWired] },
  pendingDismissPanels: {
    required: [TaskPanelInstance, TaskPanelPendingDismiss],
  },
  pendingDisposePanels: {
    required: [TaskPanelInstance, TaskPanelPendingDispose],
  },
  poppedOut: { required: [TaskPanelInstance, PopOut2DDone] },
  popInDone: { required: [TaskPanelInstance, PopIn2DDone] },
  activeTasks: { required: [Task, ActiveTask], excluded: [TaskCompleteRequested] },
  autoCompletePanels: { required: [TaskPanelInstance, TaskPanelAutoComplete] },
}) {
  private panelNarrationGeneration = 0;

  init() {
    this.cleanupFuncs.push(
      this.queries.activeTask.subscribe("qualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        const spec = TASK_PANEL_BY_TASK[taskId];
        if (!spec) return;

        const anchor = this.resolveAnchor(spec.anchor);
        if (!anchor) return;

        this.attachPanel(anchor, taskId, spec);
      }),

      this.queries.activeTask.subscribe("disqualify", (taskEntity) => {
        const taskId = taskEntity.getValue(Task, "id")!;
        if (!TASK_PANEL_BY_TASK[taskId]) return;
        this.cancelPanelNarration();
        this.stripPanel(taskId);
      }),

      this.queries.anchors.subscribe("qualify", (anchor) => {
        this.spawnPanel(anchor);
      }),

      this.queries.anchors.subscribe("disqualify", (anchor) => {
        this.destroyPanelForAnchor(anchor);
      }),

      this.queries.instances.subscribe("disqualify", (panel) => {
        panel
          .removeComponent(TaskPanelWired)
          .removeComponent(TaskPanelPendingDismiss)
          .removeComponent(TaskPanelPendingDispose);
        panel.removeComponent(TaskPanelAutoComplete);
        this.teardownPanel(panel);
      }),

      this.queries.instanceDocs.subscribe("qualify", (panel) => {
        this.popInPanel(panel);
        this.wireButton(panel);
        this.scheduleAutoComplete(panel);
        this.startPanelNarration(panel);
      }),

      this.queries.poppedOut.subscribe("qualify", (panel) => {
        const shouldComplete = this.hasPendingDismiss(panel);
        const taskId = shouldComplete
          ? panel.getValue(TaskPanelInstance, "taskId")
          : null;

        this.teardownPanel(panel);
        panel.dispose();

        if (taskId) this.completeTaskNow(taskId);
      }),

      this.queries.popInDone.subscribe("qualify", (panel) => {
        const anchor = panel.getValue(TaskPanelInstance, "anchor");
        const autoCompleteMs = anchor?.getValue(TaskPanel, "autoCompleteMs") ?? 0;
        if (autoCompleteMs <= 0 && !panel.hasComponent(PokeInteractable)) {
          panel.addComponent(PokeInteractable);
        }
      }),
    );
  }

  update(delta: number) {
    const dtMs = delta * 1000;

    for (const panel of this.queries.autoCompletePanels.entities) {
      const remaining =
        (panel.getValue(TaskPanelAutoComplete, "remainingMs") ?? 0) - dtMs;

      if (remaining <= 0) {
        panel.removeComponent(TaskPanelAutoComplete);
        void resumeAudioContext();
        panel.addComponent(TaskPanelPendingDismiss);
        this.hidePanel(panel);
      } else {
        panel.setValue(TaskPanelAutoComplete, "remainingMs", remaining);
      }
    }
  }

  private resolveAnchor(anchor: TaskPanelSpec["anchor"]): Entity | undefined {
    if (anchor === "head") return this.playerHeadEntity;
    return this.first(this.queries.phonograph.entities);
  }

  private attachPanel(
    anchor: Entity,
    taskId: string,
    spec: TaskPanelSpec,
  ): void {
    if (
      anchor.hasComponent(TaskPanel) &&
      anchor.getValue(TaskPanel, "taskId") === taskId &&
      anchor.getValue(TaskPanel, "panelConfig") === spec.panelConfig
    ) {
      return;
    }

    anchor.removeComponent(TaskPanel);
    anchor.addComponent(TaskPanel, {
      panelConfig: spec.panelConfig,
      taskId,
      maxWidth: spec.maxWidth ?? PHONOGRAPH_PANEL_MAX_WIDTH,
      offsetX: spec.offsetX ?? 0,
      offsetY:
        spec.offsetY ??
        (spec.anchor === "phonograph" ? PHONOGRAPH_ABOVE_OFFSET_Y : 0),
      offsetZ: spec.offsetZ ?? 0,
      faceTarget: spec.faceTarget ?? false,
      billboard: spec.billboard ?? false,
      buttonId: spec.buttonId ?? "",
      deferCompleteOnDismiss: spec.deferCompleteOnDismiss ?? false,
      autoCompleteMs: spec.autoCompleteMs ?? 0,
      narration: spec.narration ?? "",
    });
  }

  private cancelPanelNarration(): void {
    this.panelNarrationGeneration += 1;
    stopTaskNarration();
  }

  private startPanelNarration(panel: Entity): void {
    const anchor = panel.getValue(TaskPanelInstance, "anchor");
    const url = anchor?.getValue(TaskPanel, "narration") ?? "";
    if (!url) return;

    const generation = this.panelNarrationGeneration;
    void resumeAudioContext().then(() => {
      if (generation !== this.panelNarrationGeneration) return;
      playTaskNarration(url, 1);
    });
  }

  private stripPanel(taskId: string): void {
    for (const anchor of this.queries.panelAnchors.entities) {
      if (anchor.getValue(TaskPanel, "taskId") === taskId) {
        anchor.removeComponent(TaskPanel);
      }
    }
  }

  private spawnPanel(anchor: Entity): void {
    const anchorObj = anchor.object3D;
    if (!anchorObj) return;

    const existing = this.findPanelForAnchor(anchor);
    if (existing) {
      this.teardownPanel(existing);
      existing.dispose();
    }

    const config = resolveLocalePath(anchor.getValue(TaskPanel, "panelConfig")!);
    const taskId = anchor.getValue(TaskPanel, "taskId")!;
    const maxWidth = anchor.getValue(TaskPanel, "maxWidth") ?? PHONOGRAPH_PANEL_MAX_WIDTH;
    const faceTarget = anchor.getValue(TaskPanel, "faceTarget") ?? false;

    const panel = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PanelUI, { config, maxWidth })
      .addComponent(TaskPanelInstance, { anchor, taskId })
      .addComponent(Follower, {
        behavior: faceTarget
          ? FollowBehavior.FaceTarget
          : FollowBehavior.NoRotation,
        target: anchorObj,
        offsetPosition: [
          anchor.getValue(TaskPanel, "offsetX") ?? 0,
          anchor.getValue(TaskPanel, "offsetY") ?? 0,
          anchor.getValue(TaskPanel, "offsetZ") ?? 0,
        ],
      });

    if (anchor.getValue(TaskPanel, "billboard")) {
      panel.addComponent(Billboard);
    }

    panel.object3D!.scale.set(0.001, 0.001, 0.001);
    panel.object3D!.visible = true;
  }

  private popInPanel(panel: Entity): void {
    if (!panel.active) return;

    const doc = panel.getValue(PanelDocument, "document") as
      | UIKitDocument
      | null;
    const root = doc?.getElementById("panel-root") as UIKit.Component | undefined;
    if (root) root.scale.setScalar(0.001);

    stripPanelSurface(panel);
    if (!panel.hasComponent(PopIn2D)) {
      panel.addComponent(PopIn2D);
    }
  }

  private wireButton(panel: Entity): void {
    if (!panel.active || this.isWired(panel)) return;

    const anchor = panel.getValue(TaskPanelInstance, "anchor");
    if (!anchor?.active || !anchor.hasComponent(TaskPanel)) return;

    const buttonId = anchor.getValue(TaskPanel, "buttonId") ?? "";
    if (!buttonId) {
      panel.addComponent(TaskPanelWired);
      return;
    }

    const doc = panel.getValue(PanelDocument, "document") as UIKitDocument | null;
    const taskId = panel.getValue(TaskPanelInstance, "taskId")!;

    if (taskId === TaskId.Welcome) {
      this.wireWelcomeLanguage(doc);
    }

    const button = doc?.getElementById(buttonId);
    button?.addEventListener("pointerdown", () => {
      this.cancelPanelNarration();
      void resumeAudioContext();
      const defer = anchor.getValue(TaskPanel, "deferCompleteOnDismiss") ?? false;

      if (taskId === TaskId.Welcome) {
        this.world.sceneEntity.addComponent(StartPlacement);
        panel.addComponent(TaskPanelPendingDispose);
        panel.removeComponent(PokeInteractable);
        this.hidePanel(panel);
        this.stripPanel(TaskId.Welcome);
        return;
      }

      if (defer) {
        panel.addComponent(TaskPanelPendingDismiss);
        panel.removeComponent(PokeInteractable);
        this.hidePanel(panel);
        return;
      }

      this.completeTaskNow(taskId);
    });

    panel.addComponent(TaskPanelWired);
  }

  private wireWelcomeLanguage(doc: UIKitDocument | null): void {
    if (!doc) return;

    const selectedStyle = {
      borderColor: "rgba(255, 255, 255, 0.92)",
      backgroundColor: "rgba(255, 255, 255, 0.2)",
    };
    const idleStyle = {
      borderColor: "rgba(255, 255, 255, 0.18)",
      backgroundColor: "rgba(255, 255, 255, 0.08)",
    };

    const applyLocale = (locale: Locale) => {
      setLocale(locale);

      const show = (id: string, visible: boolean) => {
        const el = doc.getElementById(id) as
          | (UIKit.Component & {
              setProperties?: (p: Record<string, unknown>) => void;
            })
          | undefined;
        el?.setProperties?.({ display: visible ? "flex" : "none" });
      };

      show("welcome-title-en", locale === "en");
      show("welcome-title-es", locale === "es");
      show("welcome-start-en", locale === "en");
      show("welcome-start-es", locale === "es");

      const enBtn = doc.getElementById("welcome-lang-en") as
        | (UIKit.Component & {
            setProperties?: (p: Record<string, unknown>) => void;
          })
        | undefined;
      const esBtn = doc.getElementById("welcome-lang-es") as
        | (UIKit.Component & {
            setProperties?: (p: Record<string, unknown>) => void;
          })
        | undefined;
      enBtn?.setProperties?.(locale === "en" ? selectedStyle : idleStyle);
      esBtn?.setProperties?.(locale === "es" ? selectedStyle : idleStyle);
    };

    doc.getElementById("welcome-lang-en")?.addEventListener("pointerdown", () => {
      applyLocale("en");
    });
    doc.getElementById("welcome-lang-es")?.addEventListener("pointerdown", () => {
      applyLocale("es");
    });

    applyLocale(getLocale());
  }

  private scheduleAutoComplete(panel: Entity): void {
    if (panel.hasComponent(TaskPanelAutoComplete)) return;

    const anchor = panel.getValue(TaskPanelInstance, "anchor");
    if (!anchor?.active || !anchor.hasComponent(TaskPanel)) return;

    const ms = anchor.getValue(TaskPanel, "autoCompleteMs") ?? 0;
    if (ms <= 0) return;

    panel.addComponent(TaskPanelAutoComplete, { remainingMs: ms });
  }

  private hidePanel(entity: Entity): void {
    beginPanelPopOut(entity);
  }

  private completeTaskNow(taskId: string): void {
    for (const task of this.queries.activeTasks.entities) {
      if (
        task.getValue(Task, "id") === taskId &&
        !task.hasComponent(TaskCompleteRequested)
      ) {
        task.addComponent(TaskCompleteRequested);
        return;
      }
    }
  }

  private teardownPanel(panel: Entity): void {
    if (!panel.active) return;
    panel.removeComponent(TaskPanelWired);
    panel.removeComponent(TaskPanelInstance);
    hidePanelEntity(panel);
  }

  private findPanelForAnchor(anchor: Entity): Entity | undefined {
    for (const panel of this.queries.instances.entities) {
      if (panel.getValue(TaskPanelInstance, "anchor") === anchor) {
        return panel;
      }
    }
    return undefined;
  }

  private destroyPanelForAnchor(anchor: Entity): void {
    const panel = this.findPanelForAnchor(anchor);
    if (!panel) return;

    panel.removeComponent(TaskPanelAutoComplete);

    if (
      (this.hasPendingDismiss(panel) || this.hasPendingDispose(panel)) &&
      (panel.hasComponent(PopOut2D) || panel.hasComponent(PopOut2DDone))
    ) {
      return;
    }

    if (
      panel.active &&
      panel.object3D?.visible &&
      !panel.hasComponent(PopOut2D) &&
      !panel.hasComponent(PopOut2DDone) &&
      !this.hasPendingDismiss(panel)
    ) {
      panel.addComponent(TaskPanelPendingDispose);
      this.hidePanel(panel);
      return;
    }

    this.teardownPanel(panel);
    panel.dispose();
  }

  private isWired(panel: Entity): boolean {
    for (const wired of this.queries.wiredPanels.entities) {
      if (wired.index === panel.index) return true;
    }
    return false;
  }

  private hasPendingDismiss(panel: Entity): boolean {
    for (const pending of this.queries.pendingDismissPanels.entities) {
      if (pending.index === panel.index) return true;
    }
    return false;
  }

  private hasPendingDispose(panel: Entity): boolean {
    for (const pending of this.queries.pendingDisposePanels.entities) {
      if (pending.index === panel.index) return true;
    }
    return false;
  }

  private first(entities: Iterable<Entity>): Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
