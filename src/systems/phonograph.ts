import { createComponent, createSystem, Entity, eq, Quaternion, Types, Vector3 } from "@iwsdk/core";
import { Task, ActiveTask, TaskCompleteRequested } from "./task.js";
import {
  PHONOGRAPH_SPAWN_FORWARD_M,
  PHONOGRAPH_SPAWN_HEIGHT_FACTOR,
  PHONOGRAPH_SPAWN_HEIGHT_MAX_M,
  PHONOGRAPH_SPAWN_HEIGHT_MIN_M,
  TaskId,
} from "./task-config.js";
import { PopIn } from "./animation.js";

export const Phonograph = createComponent("Phonograph", {});

export const PhonographPlaced = createComponent("PhonographPlaced", {
  faceCamX: { type: Types.Float32, default: 0 },
  faceCamZ: { type: Types.Float32, default: 0 },
});

export const PhonographSpawnAnchor = createComponent("PhonographSpawnAnchor", {});

export const PhonographPart = createComponent("PhonographPart", {
  id: { type: Types.String, default: "" },
});

export function computePhonographSpawnPosition(
  camX: number,
  camZ: number,
  headY: number,
  headQuat: Quaternion,
  forward: Vector3,
): { x: number; y: number; z: number } {
  forward.set(0, 0, -1).applyQuaternion(headQuat);
  forward.y = 0;
  if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
  forward.normalize();

  const y = Math.min(
    Math.max(headY * PHONOGRAPH_SPAWN_HEIGHT_FACTOR, PHONOGRAPH_SPAWN_HEIGHT_MIN_M),
    PHONOGRAPH_SPAWN_HEIGHT_MAX_M,
  );
  return {
    x: camX + forward.x * PHONOGRAPH_SPAWN_FORWARD_M,
    y,
    z: camZ + forward.z * PHONOGRAPH_SPAWN_FORWARD_M,
  };
}

export class PhonographSystem extends createSystem({
  activeSetupTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.AssemblyIntro)],
  },
  phonograph: { required: [Phonograph] },
  placedPhonograph: { required: [Phonograph, PhonographPlaced] },
  spawnAnchor: { required: [PhonographSpawnAnchor] },
}) {
  private forward!: Vector3;
  private spawnQuat!: Quaternion;
  private spawnCamX = 0;
  private spawnCamZ = 0;
  private spawnHeadY = 0;
  private pendingAssemblyIntroSetup = false;

  init() {
    this.forward = new Vector3();
    this.spawnQuat = new Quaternion();

    this.cleanupFuncs.push(
      this.queries.activeSetupTask.subscribe("qualify", () => {
        this.pendingAssemblyIntroSetup = true;
      }),
    );
  }

  update() {
    if (!this.pendingAssemblyIntroSetup) return;
    this.pendingAssemblyIntroSetup = false;
    this.applyAssemblyIntroSetup();
  }

  private applyAssemblyIntroSetup(): void {
    const phonographEntity = this.first(this.queries.phonograph.entities);
    if (!phonographEntity?.object3D) return;

    if (this.isPlacedPhonograph(phonographEntity)) {
      phonographEntity.object3D.visible = true;
      return;
    }

    const head = this.world.player?.head;
    this.spawnCamX = this.world.camera.position.x;
    this.spawnCamZ = this.world.camera.position.z;
    this.spawnHeadY = head?.position.y ?? this.world.camera.position.y;
    this.spawnQuat.copy(head?.quaternion ?? this.world.camera.quaternion);

    const spawn = computePhonographSpawnPosition(
      this.spawnCamX,
      this.spawnCamZ,
      this.spawnHeadY,
      this.spawnQuat,
      this.forward,
    );

    phonographEntity.object3D.position.set(spawn.x, spawn.y, spawn.z);
    phonographEntity.object3D.lookAt(this.spawnCamX, spawn.y, this.spawnCamZ);
    phonographEntity.object3D.scale.setScalar(0.001);
    phonographEntity.addComponent(PopIn);
  }

  private isPlacedPhonograph(phonograph: Entity): boolean {
    for (const placed of this.queries.placedPhonograph.entities) {
      if (placed.index === phonograph.index) return true;
    }
    return false;
  }

  private first(entities: Iterable<Entity>): Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
