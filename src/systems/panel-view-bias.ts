import {
  createComponent,
  createSystem,
  Entity,
  FollowBehavior,
  Follower,
  Object3D,
  PanelUI,
  Types,
  Vector3,
} from "@iwsdk/core";
import { Billboard } from "./billboard.js";

export const PanelViewAngleBiasExcluded = createComponent("PanelViewAngleBiasExcluded", {});

export const PanelViewAngleBias = createComponent("PanelViewAngleBias", {
  baseOffsetX: { type: Types.Float32, default: 0 },
  baseOffsetY: { type: Types.Float32, default: 0 },
  baseOffsetZ: { type: Types.Float32, default: 0 },
});

const ANCHOR_HEAD_CLEARANCE_M = 0.4;
const PUSH_BACK_SCALE = 0.3;
const PUSH_BACK_EXPONENT = 1.36;
const REF_PANEL_OFFSET_Y = 0.48;
const HEIGHT_WEIGHT_EXPONENT = 1.25;
const MIN_HEIGHT_WEIGHT = 0.08;

export interface ParallaxFollowerOffset {
  x: number;
  y: number;
  z: number;
}

function panelHeightWeight(baseOffsetY: number): number {
  if (baseOffsetY <= 0) {
    return MIN_HEIGHT_WEIGHT;
  }
  const normalized = baseOffsetY / REF_PANEL_OFFSET_Y;
  return Math.max(MIN_HEIGHT_WEIGHT, Math.pow(normalized, HEIGHT_WEIGHT_EXPONENT));
}

export function computeParallaxFollowerOffset(
  baseOffsetX: number,
  baseOffsetY: number,
  baseOffsetZ: number,
  headY: number,
  anchorY: number,
  out: ParallaxFollowerOffset = { x: 0, y: 0, z: 0 },
): ParallaxFollowerOffset {
  const headAboveAnchor = headY - anchorY;

  if (headAboveAnchor <= ANCHOR_HEAD_CLEARANCE_M) {
    out.x = baseOffsetX;
    out.y = baseOffsetY;
    out.z = baseOffsetZ;
    return out;
  }

  const excess = headAboveAnchor - ANCHOR_HEAD_CLEARANCE_M;
  const basePush = PUSH_BACK_SCALE * Math.pow(excess, PUSH_BACK_EXPONENT);
  const pushBack = basePush * panelHeightWeight(baseOffsetY);

  out.x = baseOffsetX;
  out.y = baseOffsetY;
  out.z = baseOffsetZ - pushBack;
  return out;
}

export class PanelViewAngleBiasSystem extends createSystem({
  newFollowerPanels: {
    required: [Follower, Billboard, PanelUI],
    excluded: [PanelViewAngleBias, PanelViewAngleBiasExcluded],
  },
  panels: { required: [Follower, Billboard, PanelViewAngleBias] },
}) {
  private headPos!: Vector3;
  private anchorPos!: Vector3;
  private nextOffset!: ParallaxFollowerOffset;

  init() {
    this.headPos = new Vector3();
    this.anchorPos = new Vector3();
    this.nextOffset = { x: 0, y: 0, z: 0 };
    this.cleanupFuncs.push(
      this.queries.newFollowerPanels.subscribe("qualify", (entity) => {
        this.captureBaseOffset(entity);
      }),
    );
  }

  update() {
    this.player.head.getWorldPosition(this.headPos);

    for (const entity of this.queries.panels.entities) {
      const target = entity.getValue(Follower, "target") as Object3D | undefined;
      if (!target) continue;

      target.getWorldPosition(this.anchorPos);

      const baseX = entity.getValue(PanelViewAngleBias, "baseOffsetX") ?? 0;
      const baseY = entity.getValue(PanelViewAngleBias, "baseOffsetY") ?? 0;
      const baseZ = entity.getValue(PanelViewAngleBias, "baseOffsetZ") ?? 0;

      const next = computeParallaxFollowerOffset(
        baseX,
        baseY,
        baseZ,
        this.headPos.y,
        this.anchorPos.y,
        this.nextOffset,
      );

      const offsetView = entity.getVectorView(Follower, "offsetPosition") as Float32Array;
      if (
        offsetView[0] === next.x &&
        offsetView[1] === next.y &&
        offsetView[2] === next.z
      ) {
        continue;
      }

      offsetView[0] = next.x;
      offsetView[1] = next.y;
      offsetView[2] = next.z;
    }
  }

  private captureBaseOffset(entity: Entity): void {
    if (entity.hasComponent(PanelViewAngleBias)) return;
    if (entity.hasComponent(PanelViewAngleBiasExcluded)) return;
    if (entity.getValue(Follower, "behavior") === FollowBehavior.FaceTarget) return;

    const offView = entity.getVectorView(Follower, "offsetPosition") as Float32Array;

    entity.addComponent(PanelViewAngleBias, {
      baseOffsetX: offView[0],
      baseOffsetY: offView[1],
      baseOffsetZ: offView[2],
    });
  }
}
