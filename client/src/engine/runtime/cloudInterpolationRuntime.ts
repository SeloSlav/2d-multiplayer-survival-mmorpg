import type { Cloud as SpacetimeDBCloud, CloudShapeType } from '../../generated/types';

const SERVER_UPDATE_INTERVAL_MS = 5000;

interface CloudInterpolationState {
  id: string;
  serverPosX: number;
  serverPosY: number;
  lastKnownPosX: number;
  lastKnownPosY: number;
  targetPosX: number;
  targetPosY: number;
  lastServerUpdateTimeMs: number;
  width: number;
  height: number;
  rotationDegrees: number;
  baseOpacity: number;
  currentOpacity: number;
  blurStrength: number;
  shape: CloudShapeType;
}

export interface InterpolatedCloudData extends CloudInterpolationState {
  currentRenderPosX: number;
  currentRenderPosY: number;
}

interface CloudInterpolationRuntimeOptions {
  serverClouds: Map<string, SpacetimeDBCloud>;
}

function lerp(start: number, end: number, t: number): number {
  return start * (1 - t) + end * t;
}

export class CloudInterpolationRuntime {
  private readonly renderableClouds = new Map<string, InterpolatedCloudData>();
  private readonly interpolatedStates = new Map<string, CloudInterpolationState>();
  private previousServerClouds = new Map<string, SpacetimeDBCloud>();

  update({ serverClouds }: CloudInterpolationRuntimeOptions): Map<string, InterpolatedCloudData> {
    const now = performance.now();

    serverClouds.forEach((serverCloud, id) => {
      const previousState = this.interpolatedStates.get(id);
      const previousServerCloud = this.previousServerClouds.get(id);
      const serverPositionChanged = !previousServerCloud
        || previousServerCloud.posX !== serverCloud.posX
        || previousServerCloud.posY !== serverCloud.posY;

      if (!previousState || serverPositionChanged) {
        const currentRenderX = previousState?.targetPosX ?? serverCloud.posX;
        const currentRenderY = previousState?.targetPosY ?? serverCloud.posY;

        this.interpolatedStates.set(id, {
          id,
          serverPosX: serverCloud.posX,
          serverPosY: serverCloud.posY,
          lastKnownPosX: previousState && serverPositionChanged ? currentRenderX : serverCloud.posX,
          lastKnownPosY: previousState && serverPositionChanged ? currentRenderY : serverCloud.posY,
          targetPosX: serverCloud.posX,
          targetPosY: serverCloud.posY,
          lastServerUpdateTimeMs: now,
          width: serverCloud.width,
          height: serverCloud.height,
          rotationDegrees: serverCloud.rotationDegrees,
          baseOpacity: serverCloud.baseOpacity,
          currentOpacity: serverCloud.currentOpacity,
          blurStrength: serverCloud.blurStrength,
          shape: serverCloud.shape,
        });
      } else {
        this.updateVisualProps(id, previousState, serverCloud);
      }
    });

    this.interpolatedStates.forEach((_, id) => {
      if (!serverClouds.has(id)) {
        this.interpolatedStates.delete(id);
      }
    });

    this.previousServerClouds = new Map(serverClouds.entries());
    this.updateRenderableClouds(now);

    return this.renderableClouds;
  }

  stop(): void {
    this.renderableClouds.clear();
    this.interpolatedStates.clear();
    this.previousServerClouds.clear();
  }

  private updateVisualProps(
    id: string,
    previousState: CloudInterpolationState,
    serverCloud: SpacetimeDBCloud,
  ): void {
    if (
      previousState.width === serverCloud.width
      && previousState.height === serverCloud.height
      && previousState.rotationDegrees === serverCloud.rotationDegrees
      && previousState.baseOpacity === serverCloud.baseOpacity
      && previousState.currentOpacity === serverCloud.currentOpacity
      && previousState.blurStrength === serverCloud.blurStrength
      && Object.is(previousState.shape, serverCloud.shape)
    ) {
      return;
    }

    this.interpolatedStates.set(id, {
      ...previousState,
      width: serverCloud.width,
      height: serverCloud.height,
      rotationDegrees: serverCloud.rotationDegrees,
      baseOpacity: serverCloud.baseOpacity,
      currentOpacity: serverCloud.currentOpacity,
      blurStrength: serverCloud.blurStrength,
      shape: serverCloud.shape,
    });
  }

  private updateRenderableClouds(now: number): void {
    this.interpolatedStates.forEach((state, id) => {
      const timeSinceLastServerUpdate = now - state.lastServerUpdateTimeMs;
      const interpolationFactor = Math.min(1.0, timeSinceLastServerUpdate / SERVER_UPDATE_INTERVAL_MS);
      const currentRenderPosX = lerp(state.lastKnownPosX, state.targetPosX, interpolationFactor);
      const currentRenderPosY = lerp(state.lastKnownPosY, state.targetPosY, interpolationFactor);

      this.renderableClouds.set(id, {
        ...state,
        currentRenderPosX,
        currentRenderPosY,
      });
    });

    this.renderableClouds.forEach((_, id) => {
      if (!this.interpolatedStates.has(id)) {
        this.renderableClouds.delete(id);
      }
    });
  }
}
