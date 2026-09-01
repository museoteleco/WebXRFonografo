import { TaskId } from "./task-config.js";

export const INSTRUCTION_PANEL_FOLLOW_SPEED = 12;
export const INSTRUCTION_PANEL_FOLLOW_TOLERANCE = 0.05;

export interface InstructionSpec {
  panelConfig: string;
  maxWidth: number;
  anchor: "phonograph" | "part";
  partId?: string;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

export const INSTRUCTION_BY_TASK: Record<string, InstructionSpec> = {
  [TaskId.AssemblyPhonographInfo]: {
    panelConfig: "./ui/{locale}/instructions/read-more-instruction.json",
    maxWidth: 0.16,
    anchor: "phonograph",
    offsetX: 0.05,
    offsetY: 0.5,
    offsetZ: 0,
  },
  [TaskId.AssemblyCylinderMount]: {
    panelConfig: "./ui/{locale}/instructions/pinch-instruction.json",
    maxWidth: 0.16,
    anchor: "part",
    partId: "cylinder",
    offsetX: 0,
    offsetY: -0.075,
    offsetZ: 0.075,
  },
};
