import { TaskId } from "./task-config.js";

const PANEL_OFFSET_Y = 0.11;
const HORN_PANEL_OFFSET_Y = PANEL_OFFSET_Y * 1.2;

const NAME_TAG_UI_WIDTH_PX = 140;
const DETAIL_PANEL_UI_WIDTH_PX = 200;
const INFO_PANEL_METERS_PER_PX = 0.14 / 130;

const NAME_TAG_MAX_WIDTH = NAME_TAG_UI_WIDTH_PX * INFO_PANEL_METERS_PER_PX;
const DETAIL_PANEL_MAX_WIDTH = DETAIL_PANEL_UI_WIDTH_PX * INFO_PANEL_METERS_PER_PX;

export interface PartNameTagSpec {
  nameTagConfig: string;
  detailConfig: string;
  detailNarration: string;
  maxWidth: number;
  detailMaxWidth: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  infoButtonId: string;
}

const defaults = {
  maxWidth: NAME_TAG_MAX_WIDTH,
  detailMaxWidth: DETAIL_PANEL_MAX_WIDTH,
  offsetX: 0,
  offsetY: PANEL_OFFSET_Y,
  offsetZ: 0,
} as const;

function spec(
  slug: string,
  overrides: Partial<PartNameTagSpec> = {},
): PartNameTagSpec {
  return {
    nameTagConfig: `./ui/{locale}/info/${slug}-name-tag.json`,
    detailConfig: `./ui/{locale}/info/${slug}-detail.json`,
    detailNarration: `./audio/{locale}/${slug}.wav`,
    infoButtonId: `${slug}-info-button`,
    ...defaults,
    ...overrides,
  };
}

export const PART_NAME_TAG_SPECS: Record<string, PartNameTagSpec> = {
  phonograph: spec("phonograph", { offsetY: 0.44 }),
  cylinder: spec("cylinder", { offsetY: 0.16 }),
  recorder: spec("recorder"),
  recording_horn: spec("recording-horn", { offsetY: HORN_PANEL_OFFSET_Y }),
  crank: spec("crank", { offsetX: 0.15 }),
  brake: spec("brake"),
  carriage: spec("carriage", { offsetY: 0.17 }),
  reproducer: spec("reproducer"),
  listening_horn: spec("listening-horn", { offsetY: HORN_PANEL_OFFSET_Y + 0.03 }),
};

const labelOnlyNameTag = (
  slug: string,
  labelSlug: string,
  overrides: Partial<PartNameTagSpec> = {},
): PartNameTagSpec => ({
  ...spec(slug, overrides),
  nameTagConfig: `./ui/{locale}/info/${labelSlug}-name-tag.json`,
  infoButtonId: "",
  detailConfig: "",
  detailNarration: "",
});

export const TASK_NAME_TAG_SPECS: Record<
  string,
  Record<string, PartNameTagSpec>
> = {
  [TaskId.RecordingSpeakNarrate]: {
    brake: {
      ...spec("brake"),
      nameTagConfig: "./ui/{locale}/info/brake-label-name-tag.json",
      infoButtonId: "",
      detailConfig: "",
      detailNarration: "",
    },
  },
  [TaskId.PlaybackSetupRecordingHornUnmount]: {
    recording_horn: labelOnlyNameTag("recording-horn", "recording-horn-label", {
      offsetY: HORN_PANEL_OFFSET_Y,
    }),
  },
  [TaskId.PlaybackSetupRecorderUnmount]: {
    recorder: labelOnlyNameTag("recorder", "recorder-label"),
  },
  [TaskId.PlaybackSetupCarriageReturn]: {
    carriage: {
      ...spec("carriage", { offsetY: 0.17 }),
      nameTagConfig: "./ui/{locale}/info/carriage-label-name-tag.json",
      infoButtonId: "",
      detailConfig: "",
      detailNarration: "",
    },
  },
  [TaskId.PlaybackBrakeRelease]: {
    brake: {
      ...spec("brake"),
      nameTagConfig: "./ui/{locale}/info/brake-label-name-tag.json",
      infoButtonId: "",
      detailConfig: "",
      detailNarration: "",
    },
  },
  [TaskId.PlaybackCarriageLower]: {
    carriage: {
      ...spec("carriage", { offsetY: 0.17 }),
      nameTagConfig: "./ui/{locale}/info/carriage-label-name-tag.json",
      infoButtonId: "",
      detailConfig: "",
      detailNarration: "",
    },
  },
};

export function partNameTagSpecFor(partId: string): PartNameTagSpec | undefined {
  return PART_NAME_TAG_SPECS[partId];
}

export function nameTagSpecForTaskPart(
  taskId: string,
  partId: string,
): PartNameTagSpec | undefined {
  const taskSpec = TASK_NAME_TAG_SPECS[taskId]?.[partId];
  if (taskSpec) return taskSpec;
  return partNameTagSpecFor(partId);
}

export { NAME_TAG_MAX_WIDTH, DETAIL_PANEL_MAX_WIDTH, PANEL_OFFSET_Y };
