import {
  AssetManager,
  createSystem,
  Entity,
  Mesh,
  Object3D,
} from "@iwsdk/core";
import { Phonograph, PhonographPart } from "./phonograph.js";
import { Cylinder } from "./cylinder.js";
import { Crank } from "./crank.js";
import { Brake, BRAKE_STOP } from "./brake.js";
import {
  Carriage,
  CarriageMesh,
  CARRIAGE_LAYOUT,
  CARRIAGE_SNAP_POINT_IDS,
  snapPointLocalOnCarriage,
} from "./carriage.js";
import { Highlight } from "./highlight.js";
import { SnapPoint } from "./snap.js";

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

type PartBehaviorTag = "cylinder" | "crank" | "brake";

interface PartLayout {
  id: string;
  assetKey: string;
  position: Vec3;
  quaternion: Quat;
  visible: boolean;
  behaviorTag?: PartBehaviorTag;
}

interface SnapPointLayout {
  id: string;
  ghostAssetKey: string;
  position: Vec3;
  quaternion: Quat;
}

export const PART_LAYOUT: PartLayout[] = [
  {
    id: "cylinder",
    assetKey: "cylinder",
    position: [0.4, 0.05, 0.1],
    quaternion: IDENTITY_QUAT,
    visible: false,
    behaviorTag: "cylinder",
  },
  {
    id: "recorder",
    assetKey: "recorder",
    position: [-0.4, 0.018, 0.1],
    quaternion: IDENTITY_QUAT,
    visible: false,
  },
  {
    id: "reproducer",
    assetKey: "reproducer",
    position: [-0.4, 0.018, 0.1],
    quaternion: IDENTITY_QUAT,
    visible: false,
  },
  {
    id: "recording_horn",
    assetKey: "recording_horn",
    position: [-0.4, 0.1, 0.1],
    quaternion: [-0.0897, 0, 0, 0.996],
    visible: false,
  },
  {
    id: "listening_horn",
    assetKey: "listening_horn",
    position: [-0.4, 0.1225, 0.1],
    quaternion: [-0.0897, 0, 0, 0.996],
    visible: false,
  },
  {
    id: "crank",
    assetKey: "crank",
    position: [0.185, 0.085, -0.0365],
    quaternion: IDENTITY_QUAT,
    visible: false,
    behaviorTag: "crank",
  },
  {
    id: "brake",
    assetKey: "brake",
    position: [BRAKE_STOP.x, BRAKE_STOP.y, BRAKE_STOP.z],
    quaternion: IDENTITY_QUAT,
    visible: true,
    behaviorTag: "brake",
  },
];

const SNAP_POINT_LAYOUT: SnapPointLayout[] = [
  {
    id: "cylinder_snap_point",
    ghostAssetKey: "cylinder",
    position: [0.01, 0.23, -0.05],
    quaternion: [-0.000111, 0.005654, -0.019514, 1],
  },
  {
    id: "recorder_snap_point",
    ghostAssetKey: "recorder",
    position: [0.09, 0.2945, -0.01625],
    quaternion: [-0.1, -0.002, -0.02, 0.995],
  },
  {
    id: "horn_snap_point",
    ghostAssetKey: "recording_horn",
    position: [0.091, 0.3975, 0.455],
    quaternion: [-0.1078, 0, 0, 0.9942],
  },
  {
    id: "listening_horn_snap_point",
    ghostAssetKey: "listening_horn",
    position: [0.091, 0.3975, 0.455],
    quaternion: [-0.1078, 0, 0, 0.9942],
  },
];

const BEHAVIOR_TAGS = { cylinder: Cylinder, crank: Crank, brake: Brake } as const;
const CARRIAGE_SNAP_IDS = new Set<string>(CARRIAGE_SNAP_POINT_IDS);

function cloneMesh(source: Object3D): Object3D {
  const cloned = source.clone(true);
  cloned.traverse((child) => {
    if ((child as Mesh).isMesh && (child as Mesh).geometry) {
      (child as Mesh).geometry = (child as Mesh).geometry.clone();
    }
  });
  cloned.position.set(0, 0, 0);
  cloned.quaternion.set(0, 0, 0, 1);
  return cloned;
}

export class SpawnSystem extends createSystem({}) {
  init() {
    const phonograph = this.spawnPhonographRoot();
    const carriage = this.spawnCarriage(phonograph);
    this.spawnSnapPoints(phonograph, carriage);
    this.spawnParts(phonograph);
  }

  private spawnPhonographRoot(): Entity {
    const { scene: mesh } = AssetManager.getGLTF("phonograph")!;
    mesh.visible = false;
    return this.world
      .createTransformEntity(mesh, { parent: this.world.sceneEntity })
      .addComponent(Phonograph)
      .addComponent(PhonographPart, { id: "phonograph" });
  }

  private spawnSnapPoints(phonograph: Entity, carriage: Entity): void {
    for (const layout of SNAP_POINT_LAYOUT) {
      const onCarriage = CARRIAGE_SNAP_IDS.has(layout.id);
      const parent = onCarriage ? carriage : phonograph;
      const ghost = cloneMesh(AssetManager.getGLTF(layout.ghostAssetKey)!.scene);
      const entity = this.world
        .createTransformEntity(ghost, { parent })
        .addComponent(SnapPoint, { id: layout.id })
        .addComponent(Highlight);

      const obj = entity.object3D!;
      if (onCarriage) {
        obj.position.set(...snapPointLocalOnCarriage(layout.position));
      } else {
        obj.position.set(...layout.position);
      }
      obj.quaternion.set(...layout.quaternion);
      obj.scale.setScalar(0.001);
      obj.visible = false;
    }
  }

  private spawnCarriage(parent: Entity): Entity {
    const rig = this.world
      .createTransformEntity(undefined, { parent })
      .addComponent(Carriage)
      .addComponent(PhonographPart, { id: "carriage" });

    const rigObj = rig.object3D!;
    rigObj.position.set(...CARRIAGE_LAYOUT.position);
    rigObj.quaternion.set(...CARRIAGE_LAYOUT.quaternion);

    const { scene: mesh } = AssetManager.getGLTF(CARRIAGE_LAYOUT.assetKey)!;
    this.world
      .createTransformEntity(mesh, { parent: rig })
      .addComponent(CarriageMesh);
    mesh.visible = true;

    return rig;
  }

  private spawnParts(parent: Entity): void {
    for (const layout of PART_LAYOUT) {
      const { scene: mesh } = AssetManager.getGLTF(layout.assetKey)!;
      const entity = this.world
        .createTransformEntity(mesh, { parent })
        .addComponent(PhonographPart, { id: layout.id });

      const tag = layout.behaviorTag && BEHAVIOR_TAGS[layout.behaviorTag];
      if (tag) entity.addComponent(tag);

      const obj = entity.object3D!;
      obj.position.set(...layout.position);
      obj.quaternion.set(...layout.quaternion);
      obj.visible = layout.visible;
      if (!layout.visible) {
        obj.scale.setScalar(0.001);
      }
    }
  }
}
