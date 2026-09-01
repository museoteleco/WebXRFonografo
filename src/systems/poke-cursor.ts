import { createSystem } from "@iwsdk/core";

type Hand = "left" | "right";

type MultiPointerWithCursor = {
  getActiveKind(): "ray" | "grab" | "touch" | null;
  cursorVisual: { setVisible(visible: boolean): void };
};

const HANDS: readonly Hand[] = ["left", "right"];

export class HidePokeCursorSystem extends createSystem({}) {
  update() {
    for (const hand of HANDS) {
      const multiPointer = this.input.xr.multiPointers[
        hand
      ] as unknown as MultiPointerWithCursor;

      if (multiPointer.getActiveKind() === "touch") {
        multiPointer.cursorVisual.setVisible(false);
      }
    }
  }
}
