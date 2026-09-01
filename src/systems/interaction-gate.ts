import {
  ComponentRegistry,
  createComponent,
  createSystem,
  Entity,
  Grabbed,
  OneHandGrabbable,
  Types,
} from "@iwsdk/core";

export const ReleaseGrab = createComponent("ReleaseGrab", {
  removeGrabbable: { type: Types.Boolean, default: false },
});

type CancellableHandle = { cancel?: () => void };

function grabHandleComponent() {
  return ComponentRegistry.getById("Handle");
}

export function cancelActiveGrab(entity: Entity): void {
  const Handle = grabHandleComponent();
  if (Handle) {
    const handle = entity.getValue(Handle, "instance") as
      | CancellableHandle
      | undefined;
    if (handle?.cancel) {
      try {
        handle.cancel();
      } catch {
      }
    }
    if (entity.hasComponent(Handle)) {
      entity.removeComponent(Handle);
    }
  }
  if (entity.hasComponent(Grabbed)) {
    entity.removeComponent(Grabbed);
  }
}

export function cancelAllStaleGrabs(entities: Iterable<Entity>): void {
  for (const entity of entities) {
    cancelActiveGrab(entity);
  }
}

export function requestReleaseGrab(
  entity: Entity,
  options: { removeGrabbable?: boolean } = {},
): void {
  entity.addComponent(ReleaseGrab, {
    removeGrabbable: options.removeGrabbable ?? false,
  });
}

export class GrabReleaseSystem extends createSystem({
  grabbed: { required: [Grabbed] },
  releaseGrab: { required: [ReleaseGrab] },
}) {
  init() {
    this.cleanupFuncs.push(
      this.queries.releaseGrab.subscribe("qualify", (entity) => {
        cancelActiveGrab(entity);
        if (entity.getValue(ReleaseGrab, "removeGrabbable")) {
          entity.removeComponent(OneHandGrabbable);
        }
        entity.removeComponent(ReleaseGrab);
      }),
    );
  }
}
