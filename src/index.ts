import {
  AssetManifest,
  AssetType,
  ReferenceSpaceType,
  SessionMode,
  VisibilityState,
  World,
} from "@iwsdk/core";
import * as horizonKit from "@pmndrs/uikit-horizon";
import { ArrowRightIcon, CheckIcon, CircleDotIcon } from "@pmndrs/uikit-lucide";

import { Task, ActiveTask } from "./systems/task.js";
import { TaskId } from "./systems/task-config.js";
import { TaskFlowSystem } from "./systems/task-flow.js";
import { SpawnSystem } from "./systems/spawn.js";
import { AnimationSystem } from "./systems/animation.js";
import { BillboardSystem } from "./systems/billboard.js";
import { PanelViewAngleBiasSystem } from "./systems/panel-view-bias.js";
import { PartInfoSystem } from "./systems/part-info.js";
import { TaskPanelSystem } from "./systems/task-panel.js";
import { ChapterChecklistSystem } from "./systems/chapter-checklist.js";
import { AssemblyIntroSystem } from "./systems/assembly-intro.js";
import { WorldResetSystem } from "./systems/world-reset.js";
import { HighlightSystem } from "./systems/highlight.js";
import { SnapSystem } from "./systems/snap.js";
import { MountSystem } from "./systems/mount.js";
import { UnmountSystem } from "./systems/unmount.js";
import { PhonographSystem } from "./systems/phonograph.js";
import { CylinderSystem } from "./systems/cylinder.js";
import { CrankSystem } from "./systems/crank.js";
import { BrakeSystem } from "./systems/brake.js";
import { GrabReleaseSystem } from "./systems/interaction-gate.js";
import { RecordingSystem } from "./systems/recording.js";
import { CarriageSystem } from "./systems/carriage.js";
import { HidePokeCursorSystem } from "./systems/poke-cursor.js";
import { InstructionSystem } from "./systems/instruction.js";
import { PlacementSystem } from "./systems/placement.js";
import { PanelFontSystem } from "./systems/panel-fonts.js";
import { preloadPanelFonts } from "./ui/panel-fonts.js";

void preloadPanelFonts();

const assets: AssetManifest = {
  phonograph: {
    url: "./gltf/phonograph.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  cylinder: {
    url: "./gltf/cylinder.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  recorder: {
    url: "./gltf/recorder.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  reproducer: {
    url: "./gltf/reproducer.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  recording_horn: {
    url: "./gltf/recording_horn.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  listening_horn: {
    url: "./gltf/listening_horn.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  crank: {
    url: "./gltf/crank.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  brake: {
    url: "./gltf/brake.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
  carriage: {
    url: "./gltf/carriage.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: "always",
    referenceSpace: {
      type: ReferenceSpaceType.LocalFloor,
      required: true,
    },
    features: {
      handTracking: true,
      anchors: true,
      hitTest: { required: true },
      planeDetection: true,
      meshDetection: true,
      layers: true,
    },
  },
  features: {
    locomotion: false,
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: true,
    spatialUI: {
      kits: [horizonKit, { ArrowRightIcon, CheckIcon, CircleDotIcon }],
    },
  },
}).then((world) => {
  const launchScreen = document.getElementById("launch-screen");
  const unsubscribeVisibility = world.visibilityState.subscribe((state) => {
    launchScreen?.classList.toggle("is-hidden", state !== VisibilityState.NonImmersive);
  });
  import.meta.hot?.dispose(unsubscribeVisibility);

  const { camera } = world;
  camera.position.set(0, 1, 0.5);

  try {
    world
      .registerSystem(PanelFontSystem)
      .registerSystem(HighlightSystem)
      .registerSystem(PartInfoSystem)
      .registerSystem(AnimationSystem)
      .registerSystem(SpawnSystem)
      .registerSystem(PlacementSystem)
      .registerSystem(TaskFlowSystem)
      .registerSystem(PhonographSystem)
      .registerSystem(BillboardSystem)
      .registerSystem(PanelViewAngleBiasSystem)
      .registerSystem(TaskPanelSystem)
      .registerSystem(InstructionSystem)
      .registerSystem(AssemblyIntroSystem)
      .registerSystem(ChapterChecklistSystem)
      .registerSystem(GrabReleaseSystem)
      .registerSystem(WorldResetSystem)
      .registerSystem(SnapSystem)
      .registerSystem(MountSystem)
      .registerSystem(UnmountSystem)
      .registerSystem(CylinderSystem)
      .registerSystem(CrankSystem)
      .registerSystem(CarriageSystem)
      .registerSystem(RecordingSystem)
      .registerSystem(BrakeSystem)
      .registerSystem(HidePokeCursorSystem);

    world
      .createEntity()
      .addComponent(Task, { id: TaskId.Welcome })
      .addComponent(ActiveTask);
  } catch (error) {
    console.error("Failed to initialize phonograph experience:", error);
  }
}).catch((error) => {
  console.error("Failed to create IWSDK world:", error);
});
