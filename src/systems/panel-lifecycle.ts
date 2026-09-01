import { Entity, Follower, PokeInteractable } from "@iwsdk/core";
import {
  PopIn2D,
  PopIn2DDone,
  PopOut2D,
  PopOut2DDone,
} from "./animation.js";
import { Billboard } from "./billboard.js";
import { PanelViewAngleBias, PanelViewAngleBiasExcluded } from "./panel-view-bias.js";

export function stripPanelSurface(panel: Entity): void {
  panel.removeComponent(PokeInteractable);
  panel.removeComponent(PopIn2D);
  panel.removeComponent(PopOut2D);
  panel.removeComponent(PopIn2DDone);
  panel.removeComponent(PopOut2DDone);
}

export function beginPanelPopOut(panel: Entity): void {
  stripPanelSurface(panel);
  if (!panel.hasComponent(PopOut2D)) {
    panel.addComponent(PopOut2D);
  }
}

export function hidePanelEntity(panel: Entity): void {
  stripPanelSurface(panel);
  panel.removeComponent(Follower);
  panel.removeComponent(PanelViewAngleBias);
  panel.removeComponent(PanelViewAngleBiasExcluded);
  if (panel.hasComponent(Billboard)) {
    panel.removeComponent(Billboard);
  }
  if (panel.object3D) panel.object3D.visible = false;
}
