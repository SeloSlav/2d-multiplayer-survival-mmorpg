import type { MutableRef } from '../types';
import {
  idleAnimationFrameRef,
  sprintAnimationFrameRef,
  walkingAnimationFrameRef,
} from '../../hooks/useAnimationCycle';
import { shakeOffsetXRef, shakeOffsetYRef, vignetteOpacityRef } from '../../hooks/useDamageEffects';
import { renderWardParticles } from '../../hooks/useWardParticles';
import { renderLateFramePasses } from '../frame/renderLateFramePasses';
import { renderWorldPreparationPasses } from '../frame/renderWorldPreparationPasses';
import { renderEntityWorldPasses } from '../frame/renderEntityWorldPasses';
import { renderScreenSpaceWorldEffects } from '../frame/renderScreenSpaceWorldEffects';
import type { GameCanvasRuntimeHost } from './GameCanvasRuntimeHost';
import type { GameCanvasRenderRuntimeConfig } from './assembleGameCanvasRenderContext';

interface ConfigureGameCanvasRenderRuntimeOptions
  extends Omit<
    GameCanvasRenderRuntimeConfig,
    'diagnostics' | 'animationRefs' | 'damageRefs' | 'renderFunctions' | 'gameCanvasRef' | 'renderRefs'
  > {
  gameCanvasRef: MutableRef<HTMLCanvasElement | null>;
  renderRefs: {
    deltaTimeRef: MutableRef<number>;
    lastPositionsRef: MutableRef<Map<string, { x: number; y: number }>>;
    localSwimTransitionRef: MutableRef<{ wasSwimming: boolean; enteredWaterAtMs: number }>;
    swimmingPlayerScratchRef: MutableRef<any>;
    swimmingPlayerTopHalfScratchRef: MutableRef<any>;
    localPlayerScratchRef: MutableRef<Record<string, unknown>>;
    lastPlacementWarningRef: MutableRef<string | null>;
  };
  host: GameCanvasRuntimeHost;
}

export function configureGameCanvasRenderRuntime({
  host,
  ...config
}: ConfigureGameCanvasRenderRuntimeOptions) {
  const enableLagDiagnostics = false;
  const diagnostics = host.getRenderDiagnostics({
    localPlayer: config.localPlayer,
    enabled: enableLagDiagnostics,
  });

  host.configureRenderContextFromSnapshots({
    ...config,
    diagnostics,
    animationRefs: {
      walkingAnimationFrameRef,
      sprintAnimationFrameRef,
      idleAnimationFrameRef,
    },
    damageRefs: {
      shakeOffsetXRef,
      shakeOffsetYRef,
      vignetteOpacityRef,
    },
    renderFunctions: {
      renderWorldPreparationPasses,
      renderEntityWorldPasses,
      renderScreenSpaceWorldEffects,
      renderLateFramePasses,
      renderWardParticles,
    },
  });
}
