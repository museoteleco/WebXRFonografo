export const MENU_PANEL_MAX_WIDTH = 0.3;

export const PANEL_MAX_WIDTH = 10;

export const HEAD_PANEL_MAX_WIDTH = MENU_PANEL_MAX_WIDTH;

export const PHONOGRAPH_PANEL_MAX_WIDTH = PANEL_MAX_WIDTH;
export const PHONOGRAPH_ABOVE_OFFSET_Y = 0.55;
export const PHONOGRAPH_CHAPTER_OFFSET_Y = 0.48;
export const PHONOGRAPH_CHAPTER_OFFSET_Z = 0;
export const PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH = 0.3;
export const PHONOGRAPH_SPAWN_FORWARD_M = 0.7;
export const PHONOGRAPH_SPAWN_HEIGHT_FACTOR = 0.45;
export const PHONOGRAPH_SPAWN_HEIGHT_MIN_M = 0.6;
export const PHONOGRAPH_SPAWN_HEIGHT_MAX_M = 0.85;

export const TaskId = {
  Welcome: "welcome",
  AssemblyIntro: "assembly_intro",
  AssemblyPhonographInfo: "assembly_phonograph_info",
  AssemblyChapterIntro: "assembly_chapter_intro",
  AssemblyCylinderMount: "assembly_cylinder_mount",
  AssemblyRecorderMount: "assembly_recorder_mount",
  AssemblyRecordingHornMount: "assembly_recording_horn_mount",
  AssemblyChapterComplete: "assembly_chapter_complete",
  RecordingCrankWind: "recording_crank_wind",
  RecordingBrakeRelease: "recording_brake_release",
  RecordingCarriageLower: "recording_carriage_lower",
  RecordingIntermission: "recording_intermission",
  RecordingSpeakNarrate: "recording_speak_narrate",
  RecordingSpeak: "recording_speak",
  PlaybackChapterIntro: "playback_chapter_intro",
  PlaybackSetupRecordingHornUnmount: "playback_setup_recording_horn_unmount",
  PlaybackSetupRecorderUnmount: "playback_setup_recorder_unmount",
  PlaybackSetupCarriageReturn: "playback_setup_carriage_return",
  PlaybackSetupReproducerMount: "playback_setup_reproducer_mount",
  PlaybackSetupListeningHornMount: "playback_setup_listening_horn_mount",
  PlaybackListenIntro: "playback_listen_intro",
  PlaybackBrakeRelease: "playback_brake_release",
  PlaybackCarriageLower: "playback_carriage_lower",
  PlaybackListen: "playback_listen",
  ExperienceComplete: "experience_complete",
} as const;

export interface TaskPanelSpec {
  panelConfig: string;
  maxWidth?: number;
  anchor: "head" | "phonograph";
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  faceTarget?: boolean;
  billboard?: boolean;
  buttonId?: string;
  deferCompleteOnDismiss?: boolean;
  autoCompleteMs?: number;
  narration?: string;
}

export interface TaskDef {
  id: string;
  partId?: string;
  snapPointId?: string;
  panel?: TaskPanelSpec;
  revealPart?: boolean;
  revealPartId?: string;
  revealOnComplete?: string;
  unmount?: boolean;
  interactive?: boolean;
  startRecordingOnStart?: boolean;
  autoCompleteOnStart?: boolean;
  nameTagPartId?: string;
  nameTagPartIds?: string[];
  completeOnInfoDetailClose?: boolean;
}

const HEAD_MENU_PANEL = {
  maxWidth: HEAD_PANEL_MAX_WIDTH,
  anchor: "head" as const,
  offsetY: -0.15,
  offsetZ: -(PHONOGRAPH_SPAWN_FORWARD_M - 0.2),
  faceTarget: true,
};

const TASKS: TaskDef[] = [
  {
    id: TaskId.Welcome,
    panel: {
      ...HEAD_MENU_PANEL,
      panelConfig: "./ui/menus/welcome.json",
      buttonId: "welcome-begin-button",
    },
  },
  {
    id: TaskId.AssemblyIntro,
  },
  {
    id: TaskId.AssemblyPhonographInfo,
    nameTagPartId: "phonograph",
    completeOnInfoDetailClose: true,
  },
  {
    id: TaskId.AssemblyChapterIntro,
  },
  {
    id: TaskId.AssemblyCylinderMount,
    partId: "cylinder",
    snapPointId: "cylinder_snap_point",
    nameTagPartId: "cylinder",
    interactive: true,
    revealOnComplete: "recorder",
  },
  {
    id: TaskId.AssemblyRecorderMount,
    partId: "recorder",
    snapPointId: "recorder_snap_point",
    nameTagPartId: "recorder",
    interactive: true,
    revealOnComplete: "recording_horn",
  },
  {
    id: TaskId.AssemblyRecordingHornMount,
    partId: "recording_horn",
    snapPointId: "horn_snap_point",
    nameTagPartId: "recording_horn",
    interactive: true,
  },
  {
    id: TaskId.AssemblyChapterComplete,
    panel: {
      panelConfig: "./ui/{locale}/chapters/chapter-2.json",
      maxWidth: PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH,
      anchor: "phonograph",
      offsetY: PHONOGRAPH_CHAPTER_OFFSET_Y,
      offsetZ: PHONOGRAPH_CHAPTER_OFFSET_Z,
      faceTarget: true,
      billboard: true,
      buttonId: "assembly-chapter-complete-button",
      deferCompleteOnDismiss: true,
      narration: "./audio/{locale}/chapter-2.wav",
    },
  },
  {
    id: TaskId.RecordingCrankWind,
    partId: "crank",
    nameTagPartId: "crank",
    revealPart: true,
    interactive: true,
  },
  {
    id: TaskId.RecordingBrakeRelease,
    partId: "brake",
    nameTagPartId: "brake",
    interactive: true,
  },
  {
    id: TaskId.RecordingCarriageLower,
    partId: "carriage",
    nameTagPartId: "carriage",
    interactive: true,
  },
  {
    id: TaskId.RecordingIntermission,
    panel: {
      panelConfig: "./ui/{locale}/chapters/chapter-2-intermission.json",
      maxWidth: PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH,
      anchor: "phonograph",
      offsetY: PHONOGRAPH_CHAPTER_OFFSET_Y,
      offsetZ: PHONOGRAPH_CHAPTER_OFFSET_Z,
      faceTarget: true,
      billboard: true,
      buttonId: "chapter-2-intermission-button",
      deferCompleteOnDismiss: true,
      narration: "./audio/{locale}/chapter-2-intermission.wav",
    },
  },
  {
    id: TaskId.RecordingSpeakNarrate,
    startRecordingOnStart: true,
    interactive: true,
  },
  {
    id: TaskId.PlaybackChapterIntro,
    panel: {
      panelConfig: "./ui/{locale}/chapters/chapter-3.json",
      maxWidth: PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH,
      anchor: "phonograph",
      offsetY: PHONOGRAPH_CHAPTER_OFFSET_Y,
      offsetZ: PHONOGRAPH_CHAPTER_OFFSET_Z,
      faceTarget: true,
      billboard: true,
      buttonId: "playback-chapter-intro-button",
      deferCompleteOnDismiss: true,
      narration: "./audio/{locale}/chapter-3.wav",
    },
  },
  {
    id: TaskId.PlaybackSetupRecordingHornUnmount,
    partId: "recording_horn",
    nameTagPartId: "recording_horn",
    unmount: true,
    interactive: true,
  },
  {
    id: TaskId.PlaybackSetupRecorderUnmount,
    partId: "recorder",
    nameTagPartId: "recorder",
    unmount: true,
    interactive: true,
  },
  {
    id: TaskId.PlaybackSetupCarriageReturn,
    partId: "carriage",
    nameTagPartId: "carriage",
    interactive: true,
    revealOnComplete: "reproducer",
  },
  {
    id: TaskId.PlaybackSetupReproducerMount,
    partId: "reproducer",
    snapPointId: "recorder_snap_point",
    nameTagPartId: "reproducer",
    interactive: true,
    revealOnComplete: "listening_horn",
  },
  {
    id: TaskId.PlaybackSetupListeningHornMount,
    partId: "listening_horn",
    snapPointId: "listening_horn_snap_point",
    nameTagPartId: "listening_horn",
    interactive: true,
  },
  {
    id: TaskId.PlaybackListenIntro,
    panel: {
      panelConfig: "./ui/{locale}/chapters/chapter-4.json",
      maxWidth: PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH,
      anchor: "phonograph",
      offsetY: PHONOGRAPH_CHAPTER_OFFSET_Y,
      offsetZ: PHONOGRAPH_CHAPTER_OFFSET_Z,
      faceTarget: true,
      billboard: true,
      buttonId: "playback-listen-intro-button",
      deferCompleteOnDismiss: true,
      narration: "./audio/{locale}/chapter-4.wav",
    },
  },
  {
    id: TaskId.PlaybackBrakeRelease,
    partId: "brake",
    nameTagPartId: "brake",
    interactive: true,
  },
  {
    id: TaskId.PlaybackCarriageLower,
    partId: "carriage",
    nameTagPartId: "carriage",
    interactive: true,
  },
  { id: TaskId.PlaybackListen },
  {
    id: TaskId.ExperienceComplete,
    panel: {
      panelConfig: "./ui/{locale}/menus/experience-complete.json",
      maxWidth: PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH,
      anchor: "phonograph",
      offsetY: PHONOGRAPH_CHAPTER_OFFSET_Y,
      offsetZ: PHONOGRAPH_CHAPTER_OFFSET_Z,
      faceTarget: true,
      billboard: true,
      buttonId: "experience-complete-try-again-button",
      deferCompleteOnDismiss: true,
    },
  },
];

export const TASK_ORDER: string[] = TASKS.map((task) => task.id);

export interface MountBinding {
  partId: string;
  snapPointId: string;
}

export const TASK_BY_ID: Record<string, TaskDef> = {};
export const MOUNT_BY_TASK: Record<string, MountBinding> = {};
export const TASK_PANEL_BY_TASK: Record<string, TaskPanelSpec> = {};
export const UNMOUNT_BY_TASK: Record<string, { partId: string }> = {};
export const NAME_TAGS_BY_TASK: Record<string, string[]> = {};

for (const task of TASKS) {
  TASK_BY_ID[task.id] = task;
  if (task.panel) TASK_PANEL_BY_TASK[task.id] = task.panel;
  if (task.snapPointId && task.partId) {
    MOUNT_BY_TASK[task.id] = {
      partId: task.partId,
      snapPointId: task.snapPointId,
    };
  }
  if (task.unmount && task.partId) {
    UNMOUNT_BY_TASK[task.id] = { partId: task.partId };
  }
  const nameTagPartIds =
    task.nameTagPartIds ??
    (task.nameTagPartId ? [task.nameTagPartId] : undefined);
  if (nameTagPartIds?.length) {
    NAME_TAGS_BY_TASK[task.id] = nameTagPartIds;
  }
}
