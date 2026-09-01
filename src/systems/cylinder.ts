import { createComponent, createSystem } from "@iwsdk/core";
import { Brake, BrakeReleased } from "./brake.js";
import { Spin } from "./animation.js";

export const Cylinder = createComponent("Cylinder", {});

export class CylinderSystem extends createSystem({
  brakeReleased: { required: [Brake, BrakeReleased] },
  cylinder: { required: [Cylinder] },
}) {
  init() {
    this.cleanupFuncs.push(
      this.queries.brakeReleased.subscribe("qualify", () => this.setSpin(true)),
      this.queries.brakeReleased.subscribe("disqualify", () => this.setSpin(false)),
    );
  }

  private setSpin(spinning: boolean): void {
    const cylinder = this.first(this.queries.cylinder.entities);
    if (!cylinder) return;
    if (spinning) cylinder.addComponent(Spin);
    else cylinder.removeComponent(Spin);
  }

  private first(entities: Iterable<import("@iwsdk/core").Entity>): import("@iwsdk/core").Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
