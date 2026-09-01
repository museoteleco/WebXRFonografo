import { createComponent, Types } from "@iwsdk/core";
import { TaskId } from "./task-config.js";

export const Task = createComponent("Task", {
  id: { type: Types.String, default: TaskId.Welcome },
});
export const ActiveTask = createComponent("ActiveTask", {});
export const TaskCompleteRequested = createComponent("TaskCompleteRequested", {});
