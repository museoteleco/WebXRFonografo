import {
  createSystem,
  PanelDocument,
  UIKit,
  UIKitDocument,
} from "@iwsdk/core";
import { PANEL_FONT_FAMILIES, preloadPanelFonts } from "../ui/panel-fonts.js";

export class PanelFontSystem extends createSystem({
  documents: { required: [PanelDocument] },
}) {
  init() {
    void preloadPanelFonts();

    this.cleanupFuncs.push(
      this.queries.documents.subscribe("qualify", (entity) => {
        this.applyFonts(entity);
      }),
    );

    for (const entity of this.queries.documents.entities) {
      this.applyFonts(entity);
    }
  }

  private applyFonts(entity: {
    getValue: (component: typeof PanelDocument, key: "document") => unknown;
  }): void {
    const document = entity.getValue(PanelDocument, "document") as
      | UIKitDocument
      | null
      | undefined;
    const root = document?.rootElement as UIKit.Component | undefined;
    if (!root || typeof root.setProperties !== "function") return;

    root.setProperties({ fontFamilies: PANEL_FONT_FAMILIES });
  }
}
