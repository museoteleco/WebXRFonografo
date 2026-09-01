import { Entity } from "@iwsdk/core";
import { PopIn, PopInDone } from "./animation.js";

export function revealPart(part: Entity): void {
  if (part.hasComponent(PopIn) || part.hasComponent(PopInDone)) return;

  const obj = part.object3D;
  if (!obj) return;

  obj.visible = true;
  obj.scale.setScalar(0.001);
  part.addComponent(PopIn);
}
