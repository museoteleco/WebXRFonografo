import {
  createComponent,
  createSystem,
  Entity,
  EnvironmentRaycastTarget,
  eq,
  FollowBehavior,
  Follower,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  Quaternion,
  RaycastSpace,
  UIKitDocument,
  Vector3,
  VisibilityState,
} from "@iwsdk/core";
import { ACTIVE_TASK_FILTER } from "./task-flow.js";
import { Task, TaskCompleteRequested } from "./task.js";
import { TaskId } from "./task-config.js";
import {
  Phonograph,
  PhonographPlaced,
  PhonographSpawnAnchor,
  PhonographPart,
} from "./phonograph.js";
import { PART_LAYOUT } from "./spawn.js";
import { PopIn, PopInDone, PopIn2D, PopIn2DDone } from "./animation.js";
import { Billboard } from "./billboard.js";
import { hidePanelEntity, stripPanelSurface } from "./panel-lifecycle.js";
import { PanelViewAngleBiasExcluded } from "./panel-view-bias.js";
import { resolveLocalePath } from "../locale.js";
import {
  INSTRUCTION_PANEL_FOLLOW_SPEED,
  INSTRUCTION_PANEL_FOLLOW_TOLERANCE,
} from "./instruction-config.js";
import { PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH } from "./task-config.js";

export const StartPlacement = createComponent("StartPlacement", {});

export const PlacementConfirmPanel = createComponent("PlacementConfirmPanel", {});
export const PlacementConfirmInstructionPanel = createComponent(
  "PlacementConfirmInstructionPanel",
  {},
);
export const PlacementHitProbe = createComponent("PlacementHitProbe", {});

const PLACEMENT_PANEL_CONFIG = "./ui/{locale}/menus/placement-confirm.json";
const PLACEMENT_INSTRUCTION_CONFIG =
  "./ui/{locale}/instructions/placement-confirm-instruction.json";
const PLACEMENT_PANEL_MAX_WIDTH = PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH;
const PLACEMENT_INSTRUCTION_MAX_WIDTH = 0.16;
const PLACEMENT_PANEL_OFFSET_Y = 0.5;
const PLACEMENT_INSTRUCTION_OFFSET: [number, number, number] = [
  0.13,
  PLACEMENT_PANEL_OFFSET_Y - 0.09,
  0,
];

const COMFORT_FORWARD_M = 0.6;
const FLOAT_HEIGHT_HEAD_FACTOR = 0.55;
const FLOAT_HEIGHT_OFFSET_M = 0.2;
const FLOAT_FOLLOW_LERP = 0.12;
const SURFACE_SNAP_LERP = 0.2;
const STICK_SNAP_EPSILON_M = 0.025;
const HORIZONTAL_NORMAL_THRESHOLD = 0.85;
const SURFACE_HEIGHT_OFFSET_M = 0.03;
const HIT_TEST_MAX_DISTANCE_M = 1.5;
const VIEWER_RAY_PITCH_DOWN_DEG = 13;
const PHONOGRAPH_TABLE_FOOTPRINT_DEPTH_M = 0.4;
const TABLE_SURFACE_COVERAGE = 0.8;
const UNSTICK_GAZE_DOT = 0.4;
const RELOCATE_HIT_DISTANCE_M = 0.47;

function isHitTestSupported(): boolean {
  return typeof XRRay !== "undefined";
}

function viewerRayPitchOffsetQuaternion(): Quaternion {
  const pitchRad = (-VIEWER_RAY_PITCH_DOWN_DEG * Math.PI) / 180;
  return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitchRad);
}

const VIEWER_RAY_PITCH_OFFSET = viewerRayPitchOffsetQuaternion();

export class PlacementSystem extends createSystem({
  activeWelcomeTask: {
    ...ACTIVE_TASK_FILTER,
    where: [eq(Task, "id", TaskId.Welcome)],
  },
  startPlacement: { required: [StartPlacement] },
  phonograph: { required: [Phonograph] },
  phonographParts: { required: [PhonographPart] },
  confirmPanelDocs: {
    required: [PlacementConfirmPanel, PanelDocument],
  },
  confirmInstructionPanelDocs: {
    required: [PlacementConfirmInstructionPanel, PanelDocument],
  },
  confirmPanelPopInDone: {
    required: [PlacementConfirmPanel, PopIn2DDone],
  },
}) {
  private flatForward!: Vector3;
  private targetPosition!: Vector3;
  private stuckPosition!: Vector3;
  private surfaceHit!: Vector3;
  private headPosition!: Vector3;
  private tempMatrix!: Float32Array;
  private placementActive = false;
  private placementLocked = false;
  private surfaceStuck = false;
  private phonographEntity: Entity | null = null;
  private panelEntity: Entity | null = null;
  private instructionPanelEntity: Entity | null = null;
  private hitProbeEntity: Entity | null = null;
  private confirmWired = false;
  private pendingConfirmComplete = false;

  init() {
    this.flatForward = new Vector3();
    this.targetPosition = new Vector3();
    this.stuckPosition = new Vector3();
    this.surfaceHit = new Vector3();
    this.headPosition = new Vector3();
    this.tempMatrix = new Float32Array(16);

    this.cleanupFuncs.push(
      this.queries.activeWelcomeTask.subscribe("qualify", () => {
        this.teardownPlacement();
      }),

      this.queries.startPlacement.subscribe("qualify", (entity) => {
        entity.removeComponent(StartPlacement);
        this.beginPlacement();
      }),

      this.queries.activeWelcomeTask.subscribe("disqualify", () => {
        if (!this.placementLocked) {
          this.teardownPlacement();
        }
      }),

      this.queries.confirmPanelDocs.subscribe("qualify", (panel) => {
        this.popInConfirmPanel(panel);
        this.wireConfirmPanel(panel);
      }),

      this.queries.confirmInstructionPanelDocs.subscribe("qualify", (panel) => {
        this.popInConfirmPanel(panel);
      }),

      this.queries.confirmPanelPopInDone.subscribe("qualify", (panel) => {
        if (!panel.hasComponent(PokeInteractable)) {
          panel.addComponent(PokeInteractable);
        }
      }),
    );
  }

  update(_delta: number) {
    this.processPendingConfirmComplete();

    if (!this.placementActive || this.placementLocked) return;

    const state = this.visibilityState.peek();
    if (state !== VisibilityState.Visible && state !== VisibilityState.NonImmersive) {
      return;
    }

    const head = this.player.head;
    const cam = this.world.camera;
    const headObj = head ?? cam;

    headObj.getWorldPosition(this.headPosition);
    this.updatePlacementTarget(headObj.quaternion);
    this.applyLazyFollow();
  }

  private beginPlacement(): void {
    if (this.placementActive) return;

    const phonograph = this.first(this.queries.phonograph.entities);
    const phonographObj = phonograph?.object3D;
    if (!phonograph || !phonographObj) return;

    this.placementActive = true;
    this.placementLocked = false;
    this.surfaceStuck = false;
    this.confirmWired = false;
    this.pendingConfirmComplete = false;
    this.phonographEntity = phonograph;

    this.hideAttachedParts();
    phonograph.removeComponent(PopIn).removeComponent(PopInDone);
    phonographObj.scale.setScalar(0.001);
    phonographObj.visible = true;
    phonograph.addComponent(PopIn);

    const panel = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PanelUI, {
        config: resolveLocalePath(PLACEMENT_PANEL_CONFIG),
        maxWidth: PLACEMENT_PANEL_MAX_WIDTH,
      })
      .addComponent(PlacementConfirmPanel)
      .addComponent(PanelViewAngleBiasExcluded)
      .addComponent(Follower, {
        behavior: FollowBehavior.NoRotation,
        target: phonographObj,
        offsetPosition: [0, PLACEMENT_PANEL_OFFSET_Y, 0],
        speed: INSTRUCTION_PANEL_FOLLOW_SPEED,
        tolerance: INSTRUCTION_PANEL_FOLLOW_TOLERANCE,
      })
      .addComponent(Billboard);
    panel.object3D!.scale.setScalar(0.001);
    panel.object3D!.visible = true;
    this.panelEntity = panel;

    const instructionPanel = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PanelUI, {
        config: resolveLocalePath(PLACEMENT_INSTRUCTION_CONFIG),
        maxWidth: PLACEMENT_INSTRUCTION_MAX_WIDTH,
      })
      .addComponent(PlacementConfirmInstructionPanel)
      .addComponent(PanelViewAngleBiasExcluded)
      .addComponent(Follower, {
        behavior: FollowBehavior.NoRotation,
        target: phonographObj,
        offsetPosition: PLACEMENT_INSTRUCTION_OFFSET,
        speed: INSTRUCTION_PANEL_FOLLOW_SPEED,
        tolerance: INSTRUCTION_PANEL_FOLLOW_TOLERANCE,
      })
      .addComponent(Billboard);
    instructionPanel.object3D!.scale.setScalar(0.001);
    instructionPanel.object3D!.visible = true;
    this.instructionPanelEntity = instructionPanel;

    const probe = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PlacementHitProbe);
    if (isHitTestSupported()) {
      probe.addComponent(EnvironmentRaycastTarget, {
        space: RaycastSpace.Viewer,
        maxDistance: HIT_TEST_MAX_DISTANCE_M,
        offsetQuaternion: {
          x: VIEWER_RAY_PITCH_OFFSET.x,
          y: VIEWER_RAY_PITCH_OFFSET.y,
          z: VIEWER_RAY_PITCH_OFFSET.z,
          w: VIEWER_RAY_PITCH_OFFSET.w,
        },
      });
    }
    probe.object3D!.visible = false;
    this.hitProbeEntity = probe;

    this.seedInitialPosition(phonograph);
  }

  private seedInitialPosition(phonograph: Entity): void {
    const head = this.player.head;
    const cam = this.world.camera;
    const headObj = head ?? cam;

    headObj.getWorldPosition(this.headPosition);
    this.computeFallbackTarget(this.headPosition, headObj.quaternion);

    phonograph.object3D!.position.copy(this.targetPosition);
    this.facePhonographTowardUser(phonograph);
  }

  private updatePlacementTarget(headQuat: Quaternion): void {
    const hasSurfaceHit = this.readHorizontalSurfaceHit(this.surfaceHit);
    this.computeFallbackTarget(this.headPosition, headQuat);

    if (this.surfaceStuck) {
      if (this.shouldUnstickFromSurface(headQuat, hasSurfaceHit)) {
        this.surfaceStuck = false;
      } else {
        this.targetPosition.copy(this.stuckPosition);
        return;
      }
    }

    if (hasSurfaceHit) {
      this.surfaceStuck = true;
      this.stuckPosition.copy(this.surfaceHit);
      this.targetPosition.copy(this.stuckPosition);
    }
  }

  private shouldUnstickFromSurface(
    headQuat: Quaternion,
    hasSurfaceHit: boolean,
  ): boolean {
    this.flatForward.set(0, 0, -1).applyQuaternion(headQuat);
    this.flatForward.y = 0;
    if (this.flatForward.lengthSq() < 0.001) return false;
    this.flatForward.normalize();

    const toStuckX = this.stuckPosition.x - this.headPosition.x;
    const toStuckZ = this.stuckPosition.z - this.headPosition.z;
    const toStuckLenSq = toStuckX * toStuckX + toStuckZ * toStuckZ;
    if (toStuckLenSq < 1e-6) return false;

    const gazeDot =
      (this.flatForward.x * toStuckX + this.flatForward.z * toStuckZ) /
      Math.sqrt(toStuckLenSq);
    if (gazeDot < UNSTICK_GAZE_DOT) return true;

    if (hasSurfaceHit) {
      const dx = this.surfaceHit.x - this.stuckPosition.x;
      const dz = this.surfaceHit.z - this.stuckPosition.z;
      if (dx * dx + dz * dz > RELOCATE_HIT_DISTANCE_M * RELOCATE_HIT_DISTANCE_M) {
        return true;
      }
    }

    return false;
  }

  private computeFallbackTarget(
    cameraPosition: Vector3,
    headQuat: Quaternion,
  ): void {
    this.flatForward.set(0, 0, -1).applyQuaternion(headQuat);
    this.flatForward.y = 0;
    if (this.flatForward.lengthSq() < 0.001) {
      this.flatForward.set(0, 0, -1);
    }
    this.flatForward.normalize();

    this.targetPosition.set(
      cameraPosition.x + this.flatForward.x * COMFORT_FORWARD_M,
      cameraPosition.y * FLOAT_HEIGHT_HEAD_FACTOR - FLOAT_HEIGHT_OFFSET_M,
      cameraPosition.z + this.flatForward.z * COMFORT_FORWARD_M,
    );
  }

  private readHorizontalSurfaceHit(out: Vector3): boolean {
    if (!isHitTestSupported()) return false;

    const probe = this.hitProbeEntity;
    if (!probe?.active || !probe.hasComponent(EnvironmentRaycastTarget)) return false;

    const result = probe.getValue(EnvironmentRaycastTarget, "xrHitTestResult") as
      | XRHitTestResult
      | undefined;
    if (!result) return false;

    const referenceSpace = this.xrManager.getReferenceSpace();
    if (!referenceSpace) return false;

    const pose = result.getPose(referenceSpace);
    if (!pose) return false;

    this.tempMatrix.set(pose.transform.matrix);
    const normalY = this.tempMatrix[5];
    if (normalY < HORIZONTAL_NORMAL_THRESHOLD) return false;

    const hitX = this.tempMatrix[12];
    const hitY = this.tempMatrix[13];
    const hitZ = this.tempMatrix[14];

    const distance = Math.hypot(
      hitX - this.headPosition.x,
      hitY - this.headPosition.y,
      hitZ - this.headPosition.z,
    );
    if (distance > HIT_TEST_MAX_DISTANCE_M) return false;

    out.set(hitX, hitY + SURFACE_HEIGHT_OFFSET_M, hitZ);
    this.pullSurfaceHitOntoTable(out);
    return true;
  }

  private pullSurfaceHitOntoTable(hit: Vector3): void {
    const toUserX = this.headPosition.x - hit.x;
    const toUserZ = this.headPosition.z - hit.z;
    const toUserLenSq = toUserX * toUserX + toUserZ * toUserZ;
    if (toUserLenSq < 1e-6) return;

    const toUserLen = Math.sqrt(toUserLenSq);
    const pullM =
      PHONOGRAPH_TABLE_FOOTPRINT_DEPTH_M * (TABLE_SURFACE_COVERAGE - 0.5);
    hit.x += (toUserX / toUserLen) * pullM;
    hit.z += (toUserZ / toUserLen) * pullM;
  }

  private applyLazyFollow(): void {
    const phonograph = this.phonographEntity;
    const obj = phonograph?.object3D;
    if (!obj) return;

    if (this.surfaceStuck) {
      const dist = obj.position.distanceTo(this.stuckPosition);
      if (dist < STICK_SNAP_EPSILON_M) {
        obj.position.copy(this.stuckPosition);
      } else {
        obj.position.lerp(this.stuckPosition, SURFACE_SNAP_LERP);
      }
    } else {
      obj.position.lerp(this.targetPosition, FLOAT_FOLLOW_LERP);
    }

    this.facePhonographTowardUser(phonograph);
  }

  private facePhonographTowardUser(phonograph: Entity): void {
    const obj = phonograph.object3D;
    if (!obj) return;

    const dx = this.headPosition.x - obj.position.x;
    const dz = this.headPosition.z - obj.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    obj.rotation.y = Math.atan2(dx, dz);
  }

  private popInConfirmPanel(panel: Entity): void {
    stripPanelSurface(panel);
    if (!panel.hasComponent(PopIn2D)) {
      panel.addComponent(PopIn2D);
    }
  }

  private wireConfirmPanel(panel: Entity): void {
    if (this.confirmWired || !panel.active) return;

    const doc = panel.getValue(PanelDocument, "document") as UIKitDocument | null;
    const button = doc?.getElementById("placement-confirm-button");
    if (!button) return;

    button.addEventListener("pointerdown", () => {
      this.confirmPlacement();
    });
    this.confirmWired = true;
  }

  private confirmPlacement(): void {
    if (!this.placementActive || this.placementLocked) return;

    const phonograph = this.phonographEntity;
    const phonographObj = phonograph?.object3D;
    if (!phonograph || !phonographObj) return;

    this.placementLocked = true;

    const worldPos = phonographObj.position.clone();
    const worldQuat = phonographObj.quaternion.clone();

    phonograph.removeComponent(PopIn).removeComponent(PopInDone);
    phonographObj.visible = true;
    this.restorePostPlacementPartVisibility();

    phonograph.addComponent(PhonographPlaced, {
      faceCamX: this.headPosition.x,
      faceCamZ: this.headPosition.z,
    });

    this.ensureSpawnAnchor(worldPos, worldQuat);
    this.teardownPlacementUi();
    this.pendingConfirmComplete = true;
  }

  private processPendingConfirmComplete(): void {
    if (!this.pendingConfirmComplete) return;
    this.pendingConfirmComplete = false;

    for (const task of this.queries.activeWelcomeTask.entities) {
      if (!task.hasComponent(TaskCompleteRequested)) {
        task.addComponent(TaskCompleteRequested);
      }
    }
  }

  private ensureSpawnAnchor(position: Vector3, rotation: Quaternion): void {
    const anchor = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PhonographSpawnAnchor);

    const obj = anchor.object3D;
    if (!obj) return;

    obj.position.copy(position);
    obj.quaternion.copy(rotation);
    obj.visible = false;
  }

  private teardownPlacementUi(): void {
    if (this.panelEntity?.active) {
      hidePanelEntity(this.panelEntity);
      this.panelEntity.dispose();
    }
    this.panelEntity = null;

    if (this.instructionPanelEntity?.active) {
      hidePanelEntity(this.instructionPanelEntity);
      this.instructionPanelEntity.dispose();
    }
    this.instructionPanelEntity = null;

    if (this.hitProbeEntity?.active) {
      if (this.hitProbeEntity.hasComponent(EnvironmentRaycastTarget)) {
        this.hitProbeEntity.removeComponent(EnvironmentRaycastTarget);
      }
      this.hitProbeEntity.dispose();
    }
    this.hitProbeEntity = null;

    this.phonographEntity = null;
    this.placementActive = false;
  }

  private teardownPlacement(): void {
    const phonograph = this.phonographEntity;
    if (phonograph?.object3D && this.placementActive) {
      phonograph.object3D.visible = false;
      phonograph.object3D.scale.setScalar(1);
      phonograph.removeComponent(PopIn).removeComponent(PopInDone);
    }

    this.teardownPlacementUi();

    this.placementLocked = false;
    this.surfaceStuck = false;
    this.confirmWired = false;
    this.pendingConfirmComplete = false;
  }

  private hideAttachedParts(): void {
    for (const part of this.queries.phonographParts.entities) {
      const partId = part.getValue(PhonographPart, "id");
      if (partId === "phonograph" || partId === "carriage" || partId === "brake") {
        continue;
      }
      if (part.object3D) part.object3D.visible = false;
    }
  }

  private restorePostPlacementPartVisibility(): void {
    for (const part of this.queries.phonographParts.entities) {
      const partId = part.getValue(PhonographPart, "id");
      const layout = PART_LAYOUT.find((entry) => entry.id === partId);
      if (!layout?.visible || !part.object3D) continue;
      part.object3D.visible = true;
    }
  }

  private first(entities: Iterable<Entity>): Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
