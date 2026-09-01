import { createComponent, createSystem, Types, Vector3 } from "@iwsdk/core";

export const Billboard = createComponent("Billboard", {
  lockY: { type: Types.Boolean, default: false },
});

export class BillboardSystem extends createSystem({
  billboards: { required: [Billboard] },
}) {
  private lookAtTarget = new Vector3();
  private entityPos = new Vector3();

  update() {
    for (const entity of this.queries.billboards.entities) {
      const obj = entity.object3D!;
      this.player.head.getWorldPosition(this.lookAtTarget);

      if (entity.getValue(Billboard, "lockY")) {
        obj.getWorldPosition(this.entityPos);
        this.lookAtTarget.y = this.entityPos.y;
      }

      obj.lookAt(this.lookAtTarget);
    }
  }
}
